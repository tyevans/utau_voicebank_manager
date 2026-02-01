"""API router for recording session management."""

import logging
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from src.backend.domain.generated_voicebank import (
    GeneratedVoicebank,
    GenerateVoicebankRequest,
)
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    RecordingSessionSummary,
    SegmentUpload,
    SessionProgress,
)
from src.backend.ml.oto_suggester import get_oto_suggester
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.alignment_service import AlignmentService
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionNotFoundError,
    SessionStateError,
    SessionValidationError,
    VoicebankNotFoundError,
)
from src.backend.services.voicebank_generator import (
    NoAlignedSegmentsError,
    VoicebankGenerator,
    VoicebankGeneratorError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["recording-sessions"])

# Storage paths
VOICEBANKS_BASE_PATH = Path("data/voicebanks")
SESSIONS_BASE_PATH = Path("data/sessions")
GENERATED_BASE_PATH = Path("data/generated")

# Maximum segment audio size (10MB)
MAX_SEGMENT_SIZE = 10 * 1024 * 1024


def get_voicebank_repository() -> VoicebankRepository:
    """Dependency provider for VoicebankRepository."""
    return VoicebankRepository(VOICEBANKS_BASE_PATH)


def get_session_repository() -> RecordingSessionRepository:
    """Dependency provider for RecordingSessionRepository."""
    return RecordingSessionRepository(SESSIONS_BASE_PATH)


def get_session_service(
    session_repo: Annotated[
        RecordingSessionRepository, Depends(get_session_repository)
    ],
    voicebank_repo: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> RecordingSessionService:
    """Dependency provider for RecordingSessionService."""
    return RecordingSessionService(session_repo, voicebank_repo)


def get_alignment_service(
    session_service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> AlignmentService:
    """Dependency provider for AlignmentService."""
    return AlignmentService(session_service, prefer_mfa=True)


def get_voicebank_generator(
    session_service: Annotated[RecordingSessionService, Depends(get_session_service)],
    alignment_service: Annotated[AlignmentService, Depends(get_alignment_service)],
) -> VoicebankGenerator:
    """Dependency provider for VoicebankGenerator."""
    oto_suggester = get_oto_suggester()
    return VoicebankGenerator(
        session_service=session_service,
        alignment_service=alignment_service,
        oto_suggester=oto_suggester,
        output_base_path=GENERATED_BASE_PATH,
    )


@router.post("", response_model=RecordingSession, status_code=status.HTTP_201_CREATED)
async def create_session(
    request: RecordingSessionCreate,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Create a new recording session.

    Creates a guided recording session for capturing audio samples.
    The session tracks progress through the provided prompts.

    Args:
        request: Session creation parameters including voicebank_id,
            recording_style, language, and list of prompts

    Returns:
        Created recording session with ID and initial state

    Raises:
        HTTPException 400: If validation fails
        HTTPException 404: If target voicebank not found
    """
    try:
        session = await service.create(request)
        logger.info(
            f"Created recording session {session.id} for voicebank "
            f"'{request.voicebank_id}' with {len(request.prompts)} prompts"
        )
        return session
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("", response_model=list[RecordingSessionSummary])
async def list_sessions(
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    voicebank_id: str | None = None,
) -> list[RecordingSessionSummary]:
    """List recording sessions.

    Returns summaries of all recording sessions, optionally filtered
    by voicebank.

    Args:
        voicebank_id: Optional filter for specific voicebank

    Returns:
        List of session summaries sorted by creation date (newest first)
    """
    if voicebank_id:
        return await service.list_by_voicebank(voicebank_id)
    return await service.list_all()


@router.get("/{session_id}", response_model=RecordingSession)
async def get_session(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Get detailed information about a recording session.

    Args:
        session_id: Session UUID

    Returns:
        Full session details including all segments

    Raises:
        HTTPException 404: If session not found
    """
    try:
        return await service.get(session_id)
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get("/{session_id}/status", response_model=SessionProgress)
async def get_session_status(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> SessionProgress:
    """Get recording progress for a session.

    Returns progress metrics including completed segments, current prompt,
    and completion percentage.

    Args:
        session_id: Session UUID

    Returns:
        Session progress details

    Raises:
        HTTPException 404: If session not found
    """
    try:
        return await service.get_progress(session_id)
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post("/{session_id}/start", response_model=RecordingSession)
async def start_recording(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Start or resume a recording session.

    Transitions the session to the recording state.

    Args:
        session_id: Session UUID

    Returns:
        Updated session

    Raises:
        HTTPException 404: If session not found
        HTTPException 409: If session cannot be started
    """
    try:
        session = await service.start_recording(session_id)
        logger.info(f"Started recording session {session_id}")
        return session
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionStateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e


@router.post("/{session_id}/segments", response_model=RecordingSegment)
async def upload_segment(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    prompt_index: Annotated[int, Form(description="Index of the prompt recorded")],
    prompt_text: Annotated[str, Form(description="Text of the prompt recorded")],
    duration_ms: Annotated[float, Form(description="Audio duration in milliseconds")],
    audio: Annotated[UploadFile, File(description="WAV audio file")],
) -> RecordingSegment:
    """Upload a recorded audio segment.

    Uploads WAV audio for a specific prompt. The audio is stored and
    the segment is added to the session's recorded segments.

    Args:
        session_id: Session UUID
        prompt_index: Index of the prompt that was recorded
        prompt_text: The text that was read
        duration_ms: Duration of the recording in milliseconds
        audio: WAV audio file

    Returns:
        Created segment with metadata

    Raises:
        HTTPException 400: If validation fails (invalid audio, etc.)
        HTTPException 404: If session not found
        HTTPException 409: If session is not in recording state
        HTTPException 413: If audio file too large
    """
    try:
        # Read audio data
        audio_data = await audio.read()

        if len(audio_data) > MAX_SEGMENT_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Audio file too large. Maximum: {MAX_SEGMENT_SIZE // (1024*1024)}MB",
            )

        segment_info = SegmentUpload(
            prompt_index=prompt_index,
            prompt_text=prompt_text,
            duration_ms=duration_ms,
        )

        segment = await service.upload_segment(session_id, segment_info, audio_data)
        logger.info(
            f"Uploaded segment {segment.id} for session {session_id}: "
            f"prompt {prompt_index}"
        )
        return segment

    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionStateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e
    except SessionValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("/{session_id}/segments/{filename}")
async def get_segment_audio(
    session_id: UUID,
    filename: str,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> FileResponse:
    """Stream a segment's audio file.

    Args:
        session_id: Session UUID
        filename: Audio filename

    Returns:
        Audio file stream

    Raises:
        HTTPException 404: If session or audio not found
    """
    try:
        audio_path = await service.get_segment_audio_path(session_id, filename)
        return FileResponse(
            path=audio_path,
            media_type="audio/wav",
            filename=filename,
        )
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post(
    "/{session_id}/segments/{segment_id}/reject", response_model=RecordingSegment
)
async def reject_segment(
    session_id: UUID,
    segment_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    reason: Annotated[str, Form(description="Reason for rejection")] = "Quality issue",
) -> RecordingSegment:
    """Mark a segment as rejected.

    Rejects a previously uploaded segment, marking it for re-recording.

    Args:
        session_id: Session UUID
        segment_id: Segment UUID to reject
        reason: Reason for rejection

    Returns:
        Updated segment

    Raises:
        HTTPException 400: If segment not found
        HTTPException 404: If session not found
    """
    try:
        segment = await service.reject_segment(session_id, segment_id, reason)
        logger.info(f"Rejected segment {segment_id} in session {session_id}: {reason}")
        return segment
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post("/{session_id}/complete", response_model=RecordingSession)
async def complete_session(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Mark session as completed.

    Finalizes the recording session, indicating all needed segments
    have been captured.

    Args:
        session_id: Session UUID

    Returns:
        Updated session

    Raises:
        HTTPException 404: If session not found
        HTTPException 409: If session cannot be completed
    """
    try:
        session = await service.complete_session(session_id)
        logger.info(f"Completed recording session {session_id}")
        return session
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionStateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e


@router.post("/{session_id}/cancel", response_model=RecordingSession)
async def cancel_session(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Cancel a recording session.

    Aborts the session. Recorded segments are preserved but the
    session is marked as cancelled.

    Args:
        session_id: Session UUID

    Returns:
        Updated session

    Raises:
        HTTPException 404: If session not found
    """
    try:
        session = await service.cancel_session(session_id)
        logger.info(f"Cancelled recording session {session_id}")
        return session
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> None:
    """Delete a recording session.

    Permanently removes the session and all its audio data.

    Args:
        session_id: Session UUID

    Raises:
        HTTPException 404: If session not found
    """
    try:
        await service.delete(session_id)
        logger.info(f"Deleted recording session {session_id}")
    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post(
    "/{session_id}/generate-voicebank",
    response_model=GeneratedVoicebank,
    status_code=status.HTTP_201_CREATED,
)
async def generate_voicebank_from_session(
    session_id: UUID,
    request: GenerateVoicebankRequest,
    generator: Annotated[VoicebankGenerator, Depends(get_voicebank_generator)],
) -> GeneratedVoicebank:
    """Generate a complete UTAU voicebank from a recording session.

    This endpoint processes all aligned segments in the session, slices
    audio at phoneme boundaries, generates oto.ini parameters using ML,
    and creates a complete voicebank folder structure.

    The generated voicebank includes:
    - All sliced WAV samples
    - Generated oto.ini with timing parameters
    - Optional character.txt metadata file

    Args:
        session_id: UUID of the recording session to process
        request: Generation parameters including voicebank name

    Returns:
        GeneratedVoicebank with generation statistics and output path

    Raises:
        HTTPException 404: If session not found
        HTTPException 400: If no segments could be aligned
        HTTPException 500: If generation fails
    """
    try:
        output_path = Path(request.output_path) if request.output_path else None

        result = await generator.generate_from_session(
            session_id=session_id,
            voicebank_name=request.voicebank_name,
            output_path=output_path,
            include_character_txt=request.include_character_txt,
            encoding=request.encoding,
        )

        logger.info(
            f"Generated voicebank '{request.voicebank_name}' from session {session_id}: "
            f"{result.sample_count} samples, {result.oto_entries} oto entries"
        )

        return result

    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except NoAlignedSegmentsError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except VoicebankGeneratorError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Voicebank generation failed: {e}",
        ) from e
