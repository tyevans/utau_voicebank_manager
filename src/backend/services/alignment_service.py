"""Service for aligning recorded audio segments to transcripts.

Integrates forced alignment with recording sessions to generate
phoneme-level timestamps for voicebank creation.
"""

import logging
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, Field

from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_aligner import (
    AlignmentError,
    AlignmentResult,
    get_forced_aligner,
)
from src.backend.services.recording_session_service import RecordingSessionService

logger = logging.getLogger(__name__)


class SegmentAlignment(BaseModel):
    """Alignment result for a single recording segment."""

    segment_id: UUID = Field(description="Recording segment ID")
    prompt_text: str = Field(description="Original prompt text")
    audio_filename: str = Field(description="Audio filename")
    phonemes: list[PhonemeSegment] = Field(
        default_factory=list,
        description="Aligned phoneme segments",
    )
    word_segments: list[dict] = Field(
        default_factory=list,
        description="Word-level segments if available",
    )
    audio_duration_ms: float = Field(ge=0, description="Audio duration")
    alignment_method: str = Field(description="Method used for alignment")
    success: bool = Field(default=True, description="Whether alignment succeeded")
    error_message: str | None = Field(
        default=None,
        description="Error message if alignment failed",
    )


class SessionAlignmentResult(BaseModel):
    """Alignment results for an entire recording session."""

    session_id: UUID = Field(description="Recording session ID")
    voicebank_id: str = Field(description="Target voicebank")
    language: str = Field(description="Session language")
    total_segments: int = Field(description="Total segments in session")
    aligned_segments: int = Field(description="Successfully aligned segments")
    failed_segments: int = Field(description="Segments that failed alignment")
    segments: list[SegmentAlignment] = Field(
        default_factory=list,
        description="Individual segment alignments",
    )


class AlignmentServiceError(Exception):
    """Base error for alignment service."""

    pass


class AlignmentService:
    """Service for forced alignment of recording session segments.

    Uses MFA or Wav2Vec2 to generate phoneme-level timestamps
    from recorded audio segments.
    """

    def __init__(
        self,
        session_service: RecordingSessionService,
        prefer_mfa: bool = True,
    ) -> None:
        """Initialize alignment service.

        Args:
            session_service: Recording session service for accessing segments
            prefer_mfa: If True, prefer MFA when available
        """
        self._session_service = session_service
        self._prefer_mfa = prefer_mfa

    async def align_segment(
        self,
        session_id: UUID,
        segment_id: UUID,
    ) -> SegmentAlignment:
        """Align a single recording segment.

        Args:
            session_id: Recording session ID
            segment_id: Segment ID to align

        Returns:
            SegmentAlignment with phoneme timestamps

        Raises:
            SessionNotFoundError: If session not found
            AlignmentServiceError: If segment not found
        """
        session = await self._session_service.get(session_id)

        # Find the segment
        segment = None
        for s in session.segments:
            if s.id == segment_id:
                segment = s
                break

        if segment is None:
            raise AlignmentServiceError(f"Segment '{segment_id}' not found in session")

        # Get audio path
        audio_path = await self._session_service.get_segment_audio_path(
            session_id, segment.audio_filename
        )

        # Perform alignment
        return await self._align_audio_file(
            segment_id=segment.id,
            audio_path=audio_path,
            prompt_text=segment.prompt_text,
            audio_filename=segment.audio_filename,
            language=session.language,
        )

    async def align_session(
        self,
        session_id: UUID,
        skip_rejected: bool = True,
    ) -> SessionAlignmentResult:
        """Align all segments in a recording session.

        Args:
            session_id: Recording session ID
            skip_rejected: If True, skip segments marked as rejected

        Returns:
            SessionAlignmentResult with all segment alignments

        Raises:
            SessionNotFoundError: If session not found
        """
        session = await self._session_service.get(session_id)

        segments_to_align = session.segments
        if skip_rejected:
            segments_to_align = [s for s in session.segments if s.is_accepted]

        logger.info(
            f"Aligning {len(segments_to_align)} segments " f"for session {session_id}"
        )

        alignments: list[SegmentAlignment] = []
        aligned_count = 0
        failed_count = 0

        for segment in segments_to_align:
            try:
                audio_path = await self._session_service.get_segment_audio_path(
                    session_id, segment.audio_filename
                )

                alignment = await self._align_audio_file(
                    segment_id=segment.id,
                    audio_path=audio_path,
                    prompt_text=segment.prompt_text,
                    audio_filename=segment.audio_filename,
                    language=session.language,
                )

                if alignment.success:
                    aligned_count += 1
                else:
                    failed_count += 1

                alignments.append(alignment)

            except Exception as e:
                logger.warning(f"Failed to align segment {segment.id}: {e}")
                failed_count += 1
                alignments.append(
                    SegmentAlignment(
                        segment_id=segment.id,
                        prompt_text=segment.prompt_text,
                        audio_filename=segment.audio_filename,
                        phonemes=[],
                        word_segments=[],
                        audio_duration_ms=segment.duration_ms,
                        alignment_method="none",
                        success=False,
                        error_message=str(e),
                    )
                )

        return SessionAlignmentResult(
            session_id=session.id,
            voicebank_id=session.voicebank_id,
            language=session.language,
            total_segments=len(segments_to_align),
            aligned_segments=aligned_count,
            failed_segments=failed_count,
            segments=alignments,
        )

    async def _align_audio_file(
        self,
        segment_id: UUID,
        audio_path: Path,
        prompt_text: str,
        audio_filename: str,
        language: str,
    ) -> SegmentAlignment:
        """Align a single audio file.

        Args:
            segment_id: Segment identifier
            audio_path: Path to audio file
            prompt_text: Transcript text
            audio_filename: Original filename
            language: Language code

        Returns:
            SegmentAlignment result
        """
        try:
            aligner = get_forced_aligner(self._prefer_mfa)

            result: AlignmentResult = await aligner.align(
                audio_path=audio_path,
                transcript=prompt_text,
                language=language,
            )

            return SegmentAlignment(
                segment_id=segment_id,
                prompt_text=prompt_text,
                audio_filename=audio_filename,
                phonemes=result.segments,
                word_segments=result.word_segments,
                audio_duration_ms=result.audio_duration_ms,
                alignment_method=result.method,
                success=True,
                error_message=None,
            )

        except AlignmentError as e:
            logger.warning(f"Alignment failed for {audio_filename}: {e}")
            return SegmentAlignment(
                segment_id=segment_id,
                prompt_text=prompt_text,
                audio_filename=audio_filename,
                phonemes=[],
                word_segments=[],
                audio_duration_ms=0,
                alignment_method="none",
                success=False,
                error_message=str(e),
            )

    async def align_audio_file(
        self,
        audio_path: Path,
        transcript: str,
        language: str = "ja",
    ) -> AlignmentResult:
        """Align an arbitrary audio file (not from a session).

        Args:
            audio_path: Path to audio file
            transcript: Text transcript
            language: Language code

        Returns:
            AlignmentResult with phoneme timestamps
        """
        aligner = get_forced_aligner(self._prefer_mfa)
        return await aligner.align(audio_path, transcript, language)


def get_alignment_service(
    session_service: RecordingSessionService,
    prefer_mfa: bool = True,
) -> AlignmentService:
    """Create an alignment service instance.

    Creates a new instance each call so that ``prefer_mfa`` and other
    parameters are always respected.  The service object itself is cheap
    to construct -- expensive ML model loading is handled by the model
    registries/caches, not by this service.

    Args:
        session_service: Recording session service
        prefer_mfa: If True, prefer MFA when available

    Returns:
        AlignmentService instance
    """
    return AlignmentService(session_service, prefer_mfa)
