"""API router for async job management."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from src.backend.domain.generated_voicebank import (
    GeneratedVoicebank,
    GenerateVoicebankRequest,
)
from src.backend.domain.job import (
    GenerateVoicebankParams,
    Job,
    JobStatus,
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

    # Build typed job params
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
        params=params,
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


class NotifyEmailRequest(BaseModel):
    """Request body for subscribing to job completion notifications."""

    email: EmailStr = Field(
        description="Email address to receive the notification",
    )


class NotifyEmailResponse(BaseModel):
    """Response confirming a notification subscription."""

    job_id: UUID = Field(description="The job that was subscribed to")
    email: str = Field(description="The email address that will be notified")
    message: str = Field(description="Human-readable confirmation message")


@router.post(
    "/{job_id}/notify",
    response_model=NotifyEmailResponse,
    status_code=status.HTTP_200_OK,
)
async def subscribe_job_notification(
    request: Request,
    job_id: UUID,
    body: NotifyEmailRequest,
) -> NotifyEmailResponse:
    """Subscribe an email address to receive a notification when a job completes.

    Sets or updates the notification email on the job's parameters.
    If the job has already completed successfully, the notification is
    sent immediately.

    Args:
        job_id: Job UUID
        body: Email subscription request

    Returns:
        Confirmation of the subscription

    Raises:
        HTTPException 404: If the job is not found
        HTTPException 409: If the job has already failed or is in dead-letter
    """
    job_service = _get_job_service(request)

    try:
        job = await job_service.get(job_id)
    except JobNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    # Reject if the job has terminally failed
    if job.status in (JobStatus.FAILED, JobStatus.DEAD_LETTER):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job {job_id} has already failed (status: {job.status.value})",
        )

    # If the job is already completed, send notification immediately
    if job.status == JobStatus.COMPLETED and job.result and job.result.success:
        from src.backend.config import get_settings
        from src.backend.services.notification_service import NotificationService

        settings = get_settings()
        base_url = settings.base_url.rstrip("/")
        preview_url = f"{base_url}/api/v1/jobs/{job_id}/result"
        voice_name = (
            job.params.voicebank_name
            if isinstance(job.params, GenerateVoicebankParams)
            else "your voicebank"
        )

        notification_service = NotificationService(settings)
        await notification_service.notify_job_complete(
            email=body.email,
            job_id=str(job_id),
            voice_name=voice_name,
            preview_url=preview_url,
        )

        return NotifyEmailResponse(
            job_id=job_id,
            email=body.email,
            message="Job already completed. Notification sent immediately.",
        )

    # Store the email on the job params for notification when it completes
    if isinstance(job.params, GenerateVoicebankParams):
        job.params.notification_email = body.email
        await job_service.update_params(job_id, job.params)

    return NotifyEmailResponse(
        job_id=job_id,
        email=body.email,
        message=f"You will be notified at {body.email} when this job completes.",
    )
