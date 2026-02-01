"""Service layer for recording session business logic."""

from pathlib import Path
from uuid import UUID

from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    RecordingSessionSummary,
    SegmentUpload,
    SessionProgress,
    SessionStatus,
)
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository


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
    """

    # Supported recording styles
    SUPPORTED_STYLES = {"cv", "vcv", "cvvc", "vccv", "arpasing"}

    # Supported languages
    SUPPORTED_LANGUAGES = {"ja", "en", "zh", "ko"}

    def __init__(
        self,
        session_repository: RecordingSessionRepository,
        voicebank_repository: VoicebankRepository,
    ) -> None:
        """Initialize service with repositories.

        Args:
            session_repository: Repository for session storage
            voicebank_repository: Repository to validate voicebank existence
        """
        self._session_repo = session_repository
        self._voicebank_repo = voicebank_repository

    def _validate_create_request(self, request: RecordingSessionCreate) -> None:
        """Validate session creation request.

        Args:
            request: Creation request to validate

        Raises:
            SessionValidationError: If validation fails
        """
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

        if not request.prompts:
            raise SessionValidationError("At least one prompt is required")

        if len(request.prompts) > 10000:
            raise SessionValidationError("Maximum 10000 prompts per session")

    async def create(self, request: RecordingSessionCreate) -> RecordingSession:
        """Create a new recording session.

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

        # Create session
        session = RecordingSession(
            voicebank_id=request.voicebank_id,
            recording_style=request.recording_style.lower(),
            language=request.language.lower(),
            prompts=request.prompts,
            status=SessionStatus.PENDING,
        )

        return await self._session_repo.create(session)

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

        # Validate audio data (basic WAV check)
        if len(audio_data) < 44:  # Minimum WAV header size
            raise SessionValidationError("Invalid audio data: too small for WAV")

        if audio_data[:4] != b"RIFF" or audio_data[8:12] != b"WAVE":
            raise SessionValidationError("Invalid audio data: not a WAV file")

        # Generate filename
        safe_prompt = (
            segment_info.prompt_text[:20]
            .replace(" ", "_")
            .replace("/", "_")
            .replace("\\", "_")
        )
        filename = f"{segment_info.prompt_index:04d}_{safe_prompt}.wav"

        # Save audio
        await self._session_repo.save_segment_audio(session_id, filename, audio_data)

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
