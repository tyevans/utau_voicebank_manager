"""API router for recording session management."""

import io
import logging
import zipfile
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, StreamingResponse

from src.backend.domain.generated_voicebank import (
    GenerateVoicebankRequest,
)
from src.backend.domain.job import GenerateVoicebankParams, Job, JobType
from src.backend.domain.paragraph_prompt import ParagraphRecordingProgress
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    RecordingSessionSummary,
    SegmentUpload,
    SessionProgress,
)
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.paragraph_library_service import (
    ParagraphLibraryNotFoundError,
    ParagraphLibraryService,
    get_paragraph_library_service,
)
from src.backend.services.paragraph_segmentation_service import (
    ParagraphSegmentationResult,
    ParagraphSegmentationService,
    SegmentationError,
    get_paragraph_segmentation_service,
)
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionNotFoundError,
    SessionStateError,
    SessionValidationError,
    VoicebankNotGeneratedError,
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


def get_library_service() -> ParagraphLibraryService:
    """Dependency provider for ParagraphLibraryService."""
    return get_paragraph_library_service()


def get_segmentation_service(
    session_service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> ParagraphSegmentationService:
    """Dependency provider for ParagraphSegmentationService."""
    return get_paragraph_segmentation_service(
        session_service=session_service,
        prefer_mfa=True,
    )


@router.post("", response_model=RecordingSession, status_code=status.HTTP_201_CREATED)
async def create_session(
    request: RecordingSessionCreate,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> RecordingSession:
    """Create a new recording session.

    Creates a guided recording session for capturing audio samples.
    The session tracks progress through the provided prompts.

    The voicebank_id is the target name for the voicebank that will be
    created when generate-voicebank is called. It does not need to
    exist beforehand.

    Args:
        request: Session creation parameters including voicebank_id (target name),
            recording_style, language, and list of prompts

    Returns:
        Created recording session with ID and initial state

    Raises:
        HTTPException 400: If validation fails
    """
    try:
        session = await service.create(request)
        logger.info(
            f"Created recording session {session.id} for voicebank "
            f"'{request.voicebank_id}' with {len(request.prompts)} prompts"
        )
        return session
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
    response_model=Job,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_voicebank_from_session(
    session_id: UUID,
    request: GenerateVoicebankRequest,
    request_obj: Request,
) -> Job:
    """Submit a voicebank generation job for a recording session.

    This endpoint queues an async job that processes all aligned segments
    in the session, slices audio at phoneme boundaries, generates oto.ini
    parameters using ML, and creates a complete voicebank folder structure.

    The job is queued for processing by the GPU worker.
    Use GET /jobs/{id} to poll for status and progress.

    Args:
        session_id: UUID of the recording session to process
        request: Generation parameters including voicebank name
        request_obj: FastAPI request for accessing app state

    Returns:
        Job in QUEUED status with its ID for polling

    Raises:
        HTTPException 503: If Redis job queue is not available
    """
    job_service = request_obj.app.state.job_service
    if job_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job queue not available (Redis not connected)",
        )

    arq_pool = request_obj.app.state.arq_pool
    if arq_pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job queue not available (Redis not connected)",
        )

    params = GenerateVoicebankParams(
        session_id=session_id,
        voicebank_name=request.voicebank_name,
        output_path=request.output_path,
        include_character_txt=request.include_character_txt,
        encoding=request.encoding,
    )

    job = await job_service.submit(
        job_type=JobType.GENERATE_VOICEBANK,
        params=params.model_dump(mode="json"),
    )

    await arq_pool.enqueue_job(
        "generate_voicebank",
        str(job.id),
    )

    logger.info(
        "Enqueued generate_voicebank job %s for session %s",
        job.id,
        session_id,
    )

    return job


@router.get("/{session_id}/download")
async def download_voicebank(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
) -> StreamingResponse:
    """Download the generated voicebank as a ZIP file.

    Returns a downloadable ZIP archive containing all voicebank files:
    - WAV audio samples (44.1kHz mono)
    - oto.ini with ML-generated timing parameters
    - character.txt metadata (if present)
    - readme.txt with usage instructions

    The voicebank must be generated first using the generate-voicebank endpoint.

    Args:
        session_id: Session UUID

    Returns:
        StreamingResponse with ZIP file attachment

    Raises:
        HTTPException 404: If session not found or voicebank not generated
    """
    try:
        # Get voicebank path and name
        voicebank_path, voicebank_name = await service.get_generated_voicebank_path(
            session_id, GENERATED_BASE_PATH
        )

        # Create ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            # Add all WAV files
            for wav_file in voicebank_path.glob("*.wav"):
                zip_file.write(wav_file, wav_file.name)

            # Add oto.ini
            oto_path = voicebank_path / "oto.ini"
            if oto_path.exists():
                zip_file.write(oto_path, "oto.ini")

            # Add character.txt if exists
            char_path = voicebank_path / "character.txt"
            if char_path.exists():
                zip_file.write(char_path, "character.txt")

            # Generate and add readme.txt
            readme_content = _generate_readme(voicebank_name)
            zip_file.writestr("readme.txt", readme_content)

        # Seek to beginning for reading
        zip_buffer.seek(0)

        # Generate safe filename for download
        safe_filename = voicebank_name.replace('"', "'").replace("\n", " ")
        filename = f"{safe_filename}.zip"

        logger.info(
            f"Downloading voicebank '{voicebank_name}' for session {session_id}"
        )

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    except SessionNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except VoicebankNotGeneratedError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


# =============================================================================
# Paragraph Recording Endpoints
# =============================================================================


@router.post(
    "/paragraph",
    response_model=RecordingSession,
    status_code=status.HTTP_201_CREATED,
)
async def create_paragraph_session(
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    library_service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
    voicebank_id: Annotated[
        str,
        Form(description="Target voicebank name for the recording session"),
    ],
    library_id: Annotated[
        str,
        Form(description="Paragraph library ID (e.g., 'ja-cv-paragraphs-v1')"),
    ],
    use_minimal_set: Annotated[
        bool,
        Form(
            description="If true, use only the minimal paragraphs needed "
            "for full phoneme coverage"
        ),
    ] = True,
) -> RecordingSession:
    """Create a paragraph-mode recording session.

    Creates a recording session using paragraph prompts from a library.
    Paragraph prompts contain natural sentences that cover multiple phonemes,
    enabling efficient voicebank recording.

    The session will use the specified paragraph library to generate prompts.
    If use_minimal_set is true, only the minimal number of paragraphs needed
    for complete phoneme coverage will be used.

    Args:
        voicebank_id: Target voicebank name for generated samples
        library_id: Paragraph library identifier
        use_minimal_set: Use minimal paragraph set for full coverage

    Returns:
        Created recording session in paragraph mode

    Raises:
        HTTPException 400: If validation fails
        HTTPException 404: If paragraph library not found
    """
    try:
        # Get the paragraph library
        library = library_service.get_library(library_id)

        # Create session using the library
        session = await service.create_paragraph_session(
            voicebank_id=voicebank_id,
            paragraph_library=library,
            use_minimal_set=use_minimal_set,
        )

        logger.info(
            f"Created paragraph recording session {session.id} for voicebank "
            f"'{voicebank_id}' using library '{library_id}' with "
            f"{len(session.prompts)} prompts (minimal={use_minimal_set})"
        )
        return session

    except ParagraphLibraryNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SessionValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get(
    "/{session_id}/paragraph-progress",
    response_model=ParagraphRecordingProgress,
)
async def get_paragraph_progress(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    library_service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
    library_id: Annotated[
        str | None,
        Query(
            description="Paragraph library ID for phoneme coverage calculation. "
            "If not provided, coverage stats may be incomplete."
        ),
    ] = None,
) -> ParagraphRecordingProgress:
    """Get paragraph recording progress with phoneme coverage.

    Returns detailed progress for a paragraph-mode recording session,
    including phoneme coverage statistics.

    Args:
        session_id: Session UUID
        library_id: Optional library ID for accurate phoneme tracking

    Returns:
        Paragraph recording progress with coverage stats

    Raises:
        HTTPException 400: If session is not in paragraph mode
        HTTPException 404: If session not found or library not found
    """
    try:
        # Get library if specified
        paragraph_library = None
        if library_id:
            paragraph_library = library_service.get_library(library_id)

        progress = await service.get_paragraph_progress(
            session_id=session_id,
            paragraph_library=paragraph_library,
        )

        logger.debug(
            f"Paragraph progress for session {session_id}: "
            f"{progress.completed_paragraphs}/{progress.total_paragraphs} paragraphs, "
            f"{progress.phoneme_coverage_percent:.1f}% phoneme coverage"
        )
        return progress

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
    except ParagraphLibraryNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post(
    "/{session_id}/process-paragraphs",
    response_model=list[ParagraphSegmentationResult],
)
async def process_paragraph_recordings(
    session_id: UUID,
    service: Annotated[RecordingSessionService, Depends(get_session_service)],
    library_service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
    segmentation_service: Annotated[
        ParagraphSegmentationService, Depends(get_segmentation_service)
    ],
    library_id: Annotated[
        str,
        Form(description="Paragraph library ID for phoneme extraction"),
    ],
) -> list[ParagraphSegmentationResult]:
    """Process recorded paragraphs into phoneme samples.

    Uses forced alignment (MFA/Wav2Vec2) to segment recorded paragraph
    audio into individual phoneme samples. The extracted samples can
    then be used for voicebank generation.

    This endpoint processes all accepted recordings in the session,
    using the paragraph library to identify expected phonemes and
    word boundaries.

    Args:
        session_id: Session UUID
        library_id: Paragraph library ID for phoneme data

    Returns:
        List of segmentation results for each processed paragraph

    Raises:
        HTTPException 400: If session is not in paragraph mode or processing fails
        HTTPException 404: If session or library not found
    """
    try:
        # Get the paragraph library
        library = library_service.get_library(library_id)

        # Create output directory for extracted samples
        output_dir = GENERATED_BASE_PATH / "segments" / str(session_id)

        # Process paragraph recordings
        results = await service.process_paragraph_recordings(
            session_id=session_id,
            paragraph_library=library,
            output_dir=output_dir,
            segmentation_service=segmentation_service,
        )

        # Count successes and extract phonemes
        successes = sum(1 for r in results if r.success)
        total_samples = sum(len(r.extracted_samples) for r in results)

        logger.info(
            f"Processed paragraph recordings for session {session_id}: "
            f"{successes}/{len(results)} paragraphs successful, "
            f"{total_samples} phoneme samples extracted"
        )

        return results

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
    except ParagraphLibraryNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except SegmentationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Segmentation failed: {e}",
        ) from e


def _generate_readme(voicebank_name: str) -> str:
    """Generate readme.txt content for the voicebank.

    Args:
        voicebank_name: Name of the voicebank

    Returns:
        Readme content string
    """
    return f"""================================================================================
{voicebank_name} - UTAU Voicebank
================================================================================

This is an UTAU/OpenUTAU voicebank created with UTAU Voicebank Manager.

INSTALLATION
------------
1. Extract this ZIP file to your UTAU voice folder:
   - UTAU: Usually located at [UTAU installation]/voice/
   - OpenUTAU: Usually located at [OpenUTAU]/Singers/

2. The folder structure should look like:
   voice/{voicebank_name}/
       oto.ini
       *.wav

3. Restart UTAU/OpenUTAU if it was running during installation.

USAGE
-----
Select this voicebank from the singer selection in your UTAU/OpenUTAU project.
The oto.ini file contains timing parameters for each sample that were
automatically generated using machine learning analysis.

CONTENTS
--------
- oto.ini: Timing configuration for all samples
- *.wav: Audio samples (44.1kHz mono, normalized)
- character.txt: Voicebank metadata (if present)

CREDITS
-------
Generated by UTAU Voicebank Manager
https://github.com/utau-voicebank-manager

================================================================================
"""
