"""Service layer for recording session business logic."""

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from src.backend.domain.paragraph_prompt import (
    ParagraphLibrary,
    ParagraphRecordingProgress,
)
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    RecordingSessionSummary,
    SegmentUpload,
    SessionProgress,
    SessionStatus,
)
from src.backend.repositories.interfaces import (
    RecordingSessionRepositoryInterface,
    VoicebankRepositoryInterface,
)
from src.backend.utils.audio_converter import (
    AudioConversionError,
    convert_to_wav,
    is_wav,
)

if TYPE_CHECKING:
    from src.backend.services.paragraph_segmentation_service import (
        ParagraphSegmentationResult,
        ParagraphSegmentationService,
    )


class SessionNotFoundError(Exception):
    """Raised when a recording session is not found."""


class SessionValidationError(Exception):
    """Raised when session validation fails."""


class VoicebankNotFoundError(Exception):
    """Raised when the target voicebank is not found."""


class SessionStateError(Exception):
    """Raised when an operation is invalid for the current session state."""


class VoicebankNotGeneratedError(Exception):
    """Raised when a voicebank has not been generated yet."""


class RecordingSessionService:
    """Business logic for recording session operations.

    Manages the lifecycle of guided recording sessions, including
    creating sessions, uploading audio segments, and tracking progress.
    Supports both individual phoneme prompts and paragraph-based recording modes.
    """

    # Supported recording styles
    SUPPORTED_STYLES = {"cv", "vcv", "cvvc", "vccv", "arpasing"}

    # Supported languages
    SUPPORTED_LANGUAGES = {"ja", "en", "zh", "ko"}

    # Supported recording modes
    SUPPORTED_MODES = {"individual", "paragraph"}

    # Duration limits for paragraph recordings (ms)
    PARAGRAPH_MIN_DURATION_MS = 500.0
    PARAGRAPH_MAX_DURATION_MS = 30000.0

    def __init__(
        self,
        session_repository: RecordingSessionRepositoryInterface,
        voicebank_repository: VoicebankRepositoryInterface,
    ) -> None:
        """Initialize service with repositories.

        Args:
            session_repository: Repository for session storage
            voicebank_repository: Repository to validate voicebank existence
        """
        self._session_repo = session_repository
        self._voicebank_repo = voicebank_repository
        self._locks: dict[str, asyncio.Lock] = {}

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        """Get or create an asyncio lock for a specific session.

        Serializes mutating operations on the same session to prevent
        read-modify-write races (e.g., concurrent upload_segment calls).

        Args:
            session_id: Session identifier (stringified UUID)

        Returns:
            asyncio.Lock for the given session_id
        """
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    def _validate_create_request(self, request: RecordingSessionCreate) -> None:
        """Validate session creation request.

        Validates both individual and paragraph recording modes with
        mode-specific validation rules.

        Args:
            request: Creation request to validate

        Raises:
            SessionValidationError: If validation fails
        """
        # Validate recording mode
        if request.recording_mode not in self.SUPPORTED_MODES:
            raise SessionValidationError(
                f"Unsupported recording mode: {request.recording_mode}. "
                f"Supported: {', '.join(self.SUPPORTED_MODES)}"
            )

        if request.recording_style.lower() not in self.SUPPORTED_STYLES:
            raise SessionValidationError(
                f"Unsupported recording style: {request.recording_style}. "
                f"Supported: {', '.join(self.SUPPORTED_STYLES)}"
            )

        if request.language.lower() not in self.SUPPORTED_LANGUAGES:
            raise SessionValidationError(
                f"Unsupported language: {request.language}. "
                f"Supported: {', '.join(self.SUPPORTED_LANGUAGES)}"
            )

        # Mode-specific validation
        if request.recording_mode == "paragraph":
            self._validate_paragraph_request(request)
        else:
            self._validate_individual_request(request)

    def _validate_individual_request(self, request: RecordingSessionCreate) -> None:
        """Validate individual mode session creation request.

        Args:
            request: Creation request to validate

        Raises:
            SessionValidationError: If validation fails
        """
        if not request.prompts:
            raise SessionValidationError("At least one prompt is required")

        if len(request.prompts) > 10000:
            raise SessionValidationError("Maximum 10000 prompts per session")

    def _validate_paragraph_request(self, request: RecordingSessionCreate) -> None:
        """Validate paragraph mode session creation request.

        Args:
            request: Creation request to validate

        Raises:
            SessionValidationError: If validation fails
        """
        if not request.prompts:
            raise SessionValidationError("At least one paragraph prompt is required")

        if len(request.prompts) > 500:
            raise SessionValidationError("Maximum 500 paragraph prompts per session")

        # Paragraph mode requires paragraph_ids for tracking
        if not request.paragraph_ids:
            raise SessionValidationError(
                "paragraph_ids required for paragraph recording mode"
            )

        if len(request.paragraph_ids) != len(request.prompts):
            raise SessionValidationError(
                f"paragraph_ids count ({len(request.paragraph_ids)}) must match "
                f"prompts count ({len(request.prompts)})"
            )

    async def create(self, request: RecordingSessionCreate) -> RecordingSession:
        """Create a new recording session.

        Supports both individual phoneme and paragraph recording modes.

        Args:
            request: Session creation parameters

        Returns:
            Created recording session

        Raises:
            SessionValidationError: If request validation fails
        """
        # Validate request
        self._validate_create_request(request)

        # Note: voicebank_id is the target name for the new voicebank
        # The actual voicebank will be created during generateVoicebank
        # We don't require it to exist beforehand

        # Create session with mode-specific fields
        session = RecordingSession(
            voicebank_id=request.voicebank_id,
            recording_style=request.recording_style.lower(),
            language=request.language.lower(),
            recording_mode=request.recording_mode,
            prompts=request.prompts,
            paragraph_ids=request.paragraph_ids,
            status=SessionStatus.PENDING,
        )

        return await self._session_repo.create(session)

    async def create_paragraph_session(
        self,
        voicebank_id: str,
        paragraph_library: ParagraphLibrary,
        recording_style: str | None = None,
        language: str | None = None,
        use_minimal_set: bool = False,
    ) -> RecordingSession:
        """Create a session using paragraph prompts from a library.

        Convenience method for creating paragraph-mode sessions directly
        from a ParagraphLibrary, extracting prompts and IDs automatically.

        Args:
            voicebank_id: Target voicebank name
            paragraph_library: Library containing paragraph prompts
            recording_style: Override style (defaults to library style)
            language: Override language (defaults to library language)
            use_minimal_set: If True, use only the minimal paragraphs
                            needed for full phoneme coverage

        Returns:
            Created recording session

        Raises:
            SessionValidationError: If validation fails
        """
        # Select paragraphs to use
        if use_minimal_set:
            paragraphs = paragraph_library.get_minimal_set()
        else:
            paragraphs = paragraph_library.paragraphs

        # Extract prompts (sentence texts) and IDs
        prompts = [p.text for p in paragraphs]
        paragraph_ids = [p.id for p in paragraphs]

        # Create request with library defaults
        request = RecordingSessionCreate(
            voicebank_id=voicebank_id,
            recording_style=recording_style or paragraph_library.style,
            language=language or paragraph_library.language,
            recording_mode="paragraph",
            prompts=prompts,
            paragraph_ids=paragraph_ids,
        )

        return await self.create(request)

    async def get(self, session_id: UUID) -> RecordingSession:
        """Get a recording session by ID.

        Args:
            session_id: Session UUID

        Returns:
            Recording session details

        Raises:
            SessionNotFoundError: If session not found
        """
        session = await self._session_repo.get_by_id(session_id)
        if session is None:
            raise SessionNotFoundError(f"Session '{session_id}' not found")
        return session

    async def list_all(self) -> list[RecordingSessionSummary]:
        """List all recording sessions.

        Returns:
            List of session summaries sorted by creation date
        """
        return await self._session_repo.list_all()

    async def list_by_voicebank(
        self, voicebank_id: str
    ) -> list[RecordingSessionSummary]:
        """List sessions for a specific voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of session summaries for the voicebank
        """
        return await self._session_repo.list_by_voicebank(voicebank_id)

    async def get_progress(self, session_id: UUID) -> SessionProgress:
        """Get detailed progress for a session.

        Works for both individual and paragraph recording modes.

        Args:
            session_id: Session UUID

        Returns:
            Session progress details

        Raises:
            SessionNotFoundError: If session not found
        """
        session = await self.get(session_id)

        accepted = len([s for s in session.segments if s.is_accepted])
        rejected = len([s for s in session.segments if not s.is_accepted])

        current_prompt_text = None
        if session.current_prompt_index < len(session.prompts):
            current_prompt_text = session.prompts[session.current_prompt_index]

        return SessionProgress(
            session_id=session.id,
            status=session.status,
            total_prompts=len(session.prompts),
            completed_segments=accepted,
            rejected_segments=rejected,
            progress_percent=session.progress_percent,
            current_prompt_index=session.current_prompt_index,
            current_prompt_text=current_prompt_text,
        )

    async def get_paragraph_progress(
        self,
        session_id: UUID,
        paragraph_library: ParagraphLibrary | None = None,
    ) -> ParagraphRecordingProgress:
        """Get detailed progress for a paragraph-mode session.

        Provides phoneme coverage statistics in addition to paragraph progress.

        Args:
            session_id: Session UUID
            paragraph_library: Optional library for phoneme coverage tracking

        Returns:
            Paragraph recording progress with coverage stats

        Raises:
            SessionNotFoundError: If session not found
            SessionValidationError: If session is not in paragraph mode
        """
        session = await self.get(session_id)

        if session.recording_mode != "paragraph":
            raise SessionValidationError(
                f"Session {session_id} is not in paragraph mode "
                f"(mode: {session.recording_mode})"
            )

        accepted_segments = [s for s in session.segments if s.is_accepted]
        completed_paragraphs = len(accepted_segments)

        # Determine target and recorded phonemes
        target_phonemes: list[str] = []
        recorded_phonemes: list[str] = []

        if paragraph_library:
            target_phonemes = paragraph_library.target_phonemes

            # Calculate phonemes covered by completed paragraphs
            paragraph_map = {p.id: p for p in paragraph_library.paragraphs}

            for segment in accepted_segments:
                if session.paragraph_ids and segment.prompt_index < len(
                    session.paragraph_ids
                ):
                    para_id = session.paragraph_ids[segment.prompt_index]
                    if para_id in paragraph_map:
                        recorded_phonemes.extend(
                            paragraph_map[para_id].expected_phonemes
                        )

            # Deduplicate
            recorded_phonemes = list(set(recorded_phonemes))

        return ParagraphRecordingProgress(
            total_paragraphs=len(session.prompts),
            completed_paragraphs=completed_paragraphs,
            target_phonemes=target_phonemes,
            recorded_phonemes=recorded_phonemes,
        )

    async def start_recording(self, session_id: UUID) -> RecordingSession:
        """Transition session to recording state.

        Args:
            session_id: Session UUID

        Returns:
            Updated session

        Raises:
            SessionNotFoundError: If session not found
            SessionStateError: If session cannot be started
        """
        async with self._get_lock(str(session_id)):
            session = await self.get(session_id)

            if session.status not in (SessionStatus.PENDING, SessionStatus.RECORDING):
                raise SessionStateError(
                    f"Cannot start recording: session is {session.status.value}"
                )

            session.status = SessionStatus.RECORDING
            return await self._session_repo.update(session)

    async def upload_segment(
        self,
        session_id: UUID,
        segment_info: SegmentUpload,
        audio_data: bytes,
    ) -> RecordingSegment:
        """Upload a recorded audio segment.

        Handles both individual phoneme and paragraph recordings with
        appropriate validation and filename generation for each mode.

        Args:
            session_id: Session UUID
            segment_info: Metadata about the segment
            audio_data: Raw WAV audio bytes

        Returns:
            Created segment

        Raises:
            SessionNotFoundError: If session not found
            SessionStateError: If session is not in recording state
            SessionValidationError: If segment validation fails
        """
        # Validate audio data size before acquiring lock (cheap check)
        if len(audio_data) < 44:
            raise SessionValidationError("Invalid audio data: too small")

        # Convert to WAV if needed before acquiring lock (expensive I/O)
        if not is_wav(audio_data):
            try:
                audio_data = await convert_to_wav(audio_data)
            except AudioConversionError as e:
                raise SessionValidationError(f"Audio conversion failed: {e}") from e

        async with self._get_lock(str(session_id)):
            session = await self.get(session_id)

            # Validate session state
            if session.status not in (SessionStatus.PENDING, SessionStatus.RECORDING):
                raise SessionStateError(
                    f"Cannot upload segment: session is {session.status.value}"
                )

            # Validate prompt index
            if segment_info.prompt_index < 0 or segment_info.prompt_index >= len(
                session.prompts
            ):
                raise SessionValidationError(
                    f"Invalid prompt index: {segment_info.prompt_index}"
                )

            # Mode-specific duration validation
            if session.recording_mode == "paragraph":
                self._validate_paragraph_duration(segment_info.duration_ms)

            # Generate filename based on mode
            filename = self._generate_segment_filename(
                session=session,
                prompt_index=segment_info.prompt_index,
                prompt_text=segment_info.prompt_text,
            )

            # Save audio
            await self._session_repo.save_segment_audio(
                session_id, filename, audio_data
            )

            # Create segment record
            segment = RecordingSegment(
                prompt_index=segment_info.prompt_index,
                prompt_text=segment_info.prompt_text,
                audio_filename=filename,
                duration_ms=segment_info.duration_ms,
            )

            # Add to session
            session.segments.append(segment)

            # Update status and current index
            if session.status == SessionStatus.PENDING:
                session.status = SessionStatus.RECORDING

            # Move to next prompt if this was the current one
            if segment_info.prompt_index == session.current_prompt_index:
                session.current_prompt_index += 1

            # Check if complete
            if session.is_complete:
                session.status = SessionStatus.PROCESSING

            await self._session_repo.update(session)

            return segment

    def _validate_paragraph_duration(self, duration_ms: float) -> None:
        """Validate duration for paragraph recordings.

        Paragraph recordings are longer (full sentences) and should
        fall within reasonable bounds.

        Args:
            duration_ms: Recording duration in milliseconds

        Raises:
            SessionValidationError: If duration is out of bounds
        """
        if duration_ms < self.PARAGRAPH_MIN_DURATION_MS:
            raise SessionValidationError(
                f"Paragraph recording too short: {duration_ms:.0f}ms. "
                f"Minimum is {self.PARAGRAPH_MIN_DURATION_MS:.0f}ms"
            )

        if duration_ms > self.PARAGRAPH_MAX_DURATION_MS:
            raise SessionValidationError(
                f"Paragraph recording too long: {duration_ms:.0f}ms. "
                f"Maximum is {self.PARAGRAPH_MAX_DURATION_MS:.0f}ms"
            )

    def _generate_segment_filename(
        self,
        session: RecordingSession,
        prompt_index: int,
        prompt_text: str,
    ) -> str:
        """Generate filename for a recorded segment.

        Uses different naming conventions for individual vs paragraph modes.

        Args:
            session: Recording session
            prompt_index: Index of the prompt
            prompt_text: Text of the prompt

        Returns:
            Generated filename (e.g., "0000_ka.wav" or "para_001_akai_hana.wav")
        """
        if session.recording_mode == "paragraph":
            # For paragraph mode: use paragraph ID if available
            if session.paragraph_ids and prompt_index < len(session.paragraph_ids):
                para_id = session.paragraph_ids[prompt_index]
                # Extract a safe version of the paragraph ID
                safe_id = self._sanitize_name(para_id)[:30]
            else:
                # Fallback to prompt text
                safe_id = self._sanitize_name(prompt_text[:30])

            return f"para_{prompt_index:03d}_{safe_id}.wav"
        else:
            # Individual mode: original filename format
            safe_prompt = (
                prompt_text[:20].replace(" ", "_").replace("/", "_").replace("\\", "_")
            )
            return f"{prompt_index:04d}_{safe_prompt}.wav"

    async def reject_segment(
        self,
        session_id: UUID,
        segment_id: UUID,
        reason: str,
    ) -> RecordingSegment:
        """Mark a segment as rejected (needs re-recording).

        Args:
            session_id: Session UUID
            segment_id: Segment UUID to reject
            reason: Reason for rejection

        Returns:
            Updated segment

        Raises:
            SessionNotFoundError: If session not found
            SessionValidationError: If segment not found
        """
        async with self._get_lock(str(session_id)):
            session = await self.get(session_id)

            # Find segment
            segment = None
            for s in session.segments:
                if s.id == segment_id:
                    segment = s
                    break

            if segment is None:
                raise SessionValidationError(f"Segment '{segment_id}' not found")

            # Mark as rejected
            segment.is_accepted = False
            segment.rejection_reason = reason

            # Update session status back to recording if needed
            if session.status == SessionStatus.PROCESSING:
                session.status = SessionStatus.RECORDING

            await self._session_repo.update(session)

            return segment

    async def complete_session(self, session_id: UUID) -> RecordingSession:
        """Mark session as completed.

        Args:
            session_id: Session UUID

        Returns:
            Updated session

        Raises:
            SessionNotFoundError: If session not found
            SessionStateError: If session cannot be completed
        """
        async with self._get_lock(str(session_id)):
            session = await self.get(session_id)

            if session.status == SessionStatus.CANCELLED:
                raise SessionStateError("Cannot complete cancelled session")

            if session.status == SessionStatus.COMPLETED:
                return session  # Already complete

            session.status = SessionStatus.COMPLETED
            return await self._session_repo.update(session)

    async def cancel_session(self, session_id: UUID) -> RecordingSession:
        """Cancel a recording session.

        Args:
            session_id: Session UUID

        Returns:
            Updated session

        Raises:
            SessionNotFoundError: If session not found
        """
        async with self._get_lock(str(session_id)):
            session = await self.get(session_id)
            session.status = SessionStatus.CANCELLED
            return await self._session_repo.update(session)

    async def delete(self, session_id: UUID) -> None:
        """Delete a recording session and all its data.

        Args:
            session_id: Session UUID

        Raises:
            SessionNotFoundError: If session not found
        """
        async with self._get_lock(str(session_id)):
            if not await self._session_repo.exists(session_id):
                raise SessionNotFoundError(f"Session '{session_id}' not found")

            await self._session_repo.delete(session_id)

    async def get_segment_audio_path(
        self,
        session_id: UUID,
        filename: str,
    ) -> Path:
        """Get path to a segment's audio file.

        Args:
            session_id: Session UUID
            filename: Audio filename

        Returns:
            Path to audio file

        Raises:
            SessionNotFoundError: If session or audio not found
        """
        path = await self._session_repo.get_segment_audio_path(session_id, filename)
        if path is None:
            raise SessionNotFoundError(
                f"Audio '{filename}' not found in session '{session_id}'"
            )
        return path

    async def get_generated_voicebank_path(
        self,
        session_id: UUID,
        generated_base_path: Path,
    ) -> tuple[Path, str]:
        """Get path to a session's generated voicebank folder.

        Args:
            session_id: Session UUID
            generated_base_path: Base path where voicebanks are generated

        Returns:
            Tuple of (voicebank_path, voicebank_name)

        Raises:
            SessionNotFoundError: If session not found
            VoicebankNotGeneratedError: If voicebank has not been generated
        """
        session = await self.get(session_id)
        voicebank_name = session.voicebank_id

        # Sanitize name using same logic as voicebank_generator
        safe_name = self._sanitize_name(voicebank_name)
        voicebank_path = generated_base_path / safe_name

        if not voicebank_path.exists():
            raise VoicebankNotGeneratedError(
                f"Voicebank '{voicebank_name}' has not been generated yet. "
                f"Use the generate-voicebank endpoint first."
            )

        # Verify oto.ini exists (minimum requirement for a valid voicebank)
        oto_path = voicebank_path / "oto.ini"
        if not oto_path.exists():
            raise VoicebankNotGeneratedError(
                f"Voicebank '{voicebank_name}' is incomplete (missing oto.ini). "
                f"Please regenerate the voicebank."
            )

        return voicebank_path, voicebank_name

    def _sanitize_name(self, name: str) -> str:
        """Sanitize a name for use in filenames.

        This matches the logic in voicebank_generator.py.

        Args:
            name: Original name

        Returns:
            Sanitized name safe for filesystem
        """
        # Replace unsafe characters
        safe = name.replace(" ", "_").replace("/", "_").replace("\\", "_")
        safe = safe.replace(":", "_").replace("*", "_").replace("?", "_")
        safe = safe.replace('"', "_").replace("<", "_").replace(">", "_")
        safe = safe.replace("|", "_")

        # Remove leading/trailing underscores
        safe = safe.strip("_")

        # Ensure non-empty
        if not safe:
            safe = "sample"

        return safe[:50]  # Limit length

    async def process_paragraph_recordings(
        self,
        session_id: UUID,
        paragraph_library: ParagraphLibrary,
        output_dir: Path,
        segmentation_service: "ParagraphSegmentationService",
    ) -> list["ParagraphSegmentationResult"]:
        """Process all paragraph recordings in a session.

        Uses forced alignment to segment recorded paragraphs into individual
        phoneme samples for the voicebank.

        For each recorded paragraph segment:
        1. Get the matching ParagraphPrompt from library
        2. Run ParagraphSegmentationService.segment_paragraph()
        3. Store extracted samples in output_dir
        4. Return segmentation results

        Args:
            session_id: Session UUID
            paragraph_library: Library with paragraph prompts and phoneme data
            output_dir: Directory to store extracted phoneme samples
            segmentation_service: Service for paragraph segmentation

        Returns:
            List of segmentation results for each processed paragraph

        Raises:
            SessionNotFoundError: If session not found
            SessionValidationError: If session is not in paragraph mode
        """
        session = await self.get(session_id)

        if session.recording_mode != "paragraph":
            raise SessionValidationError(
                f"Session {session_id} is not in paragraph mode "
                f"(mode: {session.recording_mode})"
            )

        if not session.paragraph_ids:
            raise SessionValidationError(
                f"Session {session_id} has no paragraph IDs for processing"
            )

        # Build paragraph lookup
        paragraph_map = {p.id: p for p in paragraph_library.paragraphs}

        results: list[ParagraphSegmentationResult] = []

        for segment in session.segments:
            # Skip rejected segments
            if not segment.is_accepted:
                continue

            # Get paragraph ID for this segment
            if segment.prompt_index >= len(session.paragraph_ids):
                continue

            para_id = session.paragraph_ids[segment.prompt_index]

            # Get paragraph prompt
            paragraph = paragraph_map.get(para_id)
            if not paragraph:
                # Skip if paragraph not found in library
                continue

            # Get audio path
            try:
                audio_path = await self.get_segment_audio_path(
                    session_id, segment.audio_filename
                )
            except SessionNotFoundError:
                # Audio file missing, skip
                continue

            # Create output directory for this paragraph
            segment_output_dir = output_dir / para_id

            # Run segmentation
            result = await segmentation_service.segment_paragraph(
                audio_path=audio_path,
                paragraph=paragraph,
                output_dir=segment_output_dir,
            )
            results.append(result)

        return results
