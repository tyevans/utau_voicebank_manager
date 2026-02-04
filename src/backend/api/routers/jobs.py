"""API router for async job management."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from src.backend.domain.generated_voicebank import (
    GeneratedVoicebank,
    GenerateVoicebankRequest,
)
from src.backend.domain.job import (
    GenerateVoicebankParams,
    Job,
    JobType,
)
from src.backend.services.job_service import JobNotFoundError, JobService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _get_job_service(request: Request) -> JobService:
    """Get JobService from app state, or 503 if Redis unavailable."""
    job_service = request.app.state.job_service
    if job_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job queue not available (Redis not connected)",
        )
    return job_service


def _get_arq_pool(request: Request):
    """Get arq Redis pool from app state, or 503 if Redis unavailable."""
    arq_pool = request.app.state.arq_pool
    if arq_pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job queue not available (Redis not connected)",
        )
    return arq_pool


@router.post(
    "/generate-voicebank",
    response_model=Job,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_generate_voicebank(
    request: Request,
    body: GenerateVoicebankRequest,
    session_id: UUID,  # Query parameter
) -> Job:
    """Submit a voicebank generation job.

    The job is queued for processing by the GPU worker.
    Use GET /jobs/{id} to poll for status and progress.

    Args:
        session_id: Recording session UUID (query param)
        body: Generation parameters (voicebank name, encoding, etc.)

    Returns:
        Job in QUEUED status with its ID for polling
    """
    job_service = _get_job_service(request)
    arq_pool = _get_arq_pool(request)

    # Build job params
    params = GenerateVoicebankParams(
        session_id=session_id,
        voicebank_name=body.voicebank_name,
        output_path=body.output_path,
        include_character_txt=body.include_character_txt,
        encoding=body.encoding,
    )

    # Submit job to Redis
    job = await job_service.submit(
        job_type=JobType.GENERATE_VOICEBANK,
        params=params.model_dump(mode="json"),
    )

    # Enqueue the arq task
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


@router.get("/{job_id}", response_model=Job)
async def get_job_status(
    request: Request,
    job_id: UUID,
) -> Job:
    """Get job status and progress.

    Returns the current state of a job including progress
    percentage and status message if running.

    Args:
        job_id: Job UUID

    Returns:
        Job with current status and progress

    Raises:
        HTTPException 404: If job not found
    """
    job_service = _get_job_service(request)

    try:
        return await job_service.get(job_id)
    except JobNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get("/{job_id}/result", response_model=GeneratedVoicebank)
async def get_job_result(
    request: Request,
    job_id: UUID,
) -> GeneratedVoicebank:
    """Get the result of a completed job.

    Returns the GeneratedVoicebank data for a successfully
    completed generate-voicebank job.

    Args:
        job_id: Job UUID

    Returns:
        GeneratedVoicebank result data

    Raises:
        HTTPException 404: If job not found
        HTTPException 409: If job is not yet completed or failed
    """
    job_service = _get_job_service(request)

    try:
        job = await job_service.get(job_id)
    except JobNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    if job.result is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job {job_id} has not completed yet (status: {job.status.value})",
        )

    if not job.result.success:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job {job_id} failed: {job.result.error}",
        )

    # Parse result data back into GeneratedVoicebank
    return GeneratedVoicebank.model_validate(job.result.data)
