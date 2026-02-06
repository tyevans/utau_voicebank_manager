"""arq task for generating voicebanks from recording sessions.

Includes configurable retry logic with exponential backoff and
dead-letter queue for permanently failed jobs.
"""

import asyncio
import logging
from pathlib import Path
from typing import Any
from uuid import UUID

from src.backend.config import get_settings
from src.backend.domain.job import (
    GenerateVoicebankParams,
    JobResult,
    JobStatus,
)
from src.backend.ml.oto_suggester import get_oto_suggester
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.alignment_service import AlignmentService
from src.backend.services.job_service import JobService
from src.backend.services.notification_service import NotificationService
from src.backend.services.recording_session_service import RecordingSessionService
from src.backend.services.voicebank_generator import VoicebankGenerator
from src.backend.worker.progress import RedisProgressCallback

logger = logging.getLogger(__name__)

# Errors that should NOT be retried (user/input errors, not infra)
_NON_RETRYABLE_ERRORS = (
    ValueError,
    KeyError,
    FileNotFoundError,
)


def _calculate_backoff(
    retry_count: int,
    base_delay: float,
    max_delay: float,
) -> float:
    """Calculate exponential backoff delay with a cap.

    Args:
        retry_count: Current retry number (1-based)
        base_delay: Base delay in seconds
        max_delay: Maximum delay cap in seconds

    Returns:
        Delay in seconds before the next retry
    """
    delay = base_delay * (2 ** (retry_count - 1))
    return min(delay, max_delay)


async def _run_generation(
    ctx: dict[str, Any],
    job_id: UUID,
    params: GenerateVoicebankParams,
) -> JobResult:
    """Execute the actual voicebank generation.

    Separated from retry logic for clarity. Builds the service graph,
    runs the generator, and returns a JobResult.

    Args:
        ctx: arq context dict (contains job_service from startup)
        job_id: UUID of the job
        params: Parsed generation parameters

    Returns:
        JobResult with success=True and result data

    Raises:
        Any exception from the generation pipeline
    """
    settings = get_settings()
    job_service: JobService = ctx["job_service"]

    # Build the service graph
    session_repo = RecordingSessionRepository(settings.sessions_path)
    voicebank_repo = VoicebankRepository(settings.voicebanks_path)
    session_service = RecordingSessionService(session_repo, voicebank_repo)
    alignment_service = AlignmentService(session_service, prefer_mfa=True)
    oto_suggester = get_oto_suggester()

    generator = VoicebankGenerator(
        session_service=session_service,
        alignment_service=alignment_service,
        oto_suggester=oto_suggester,
        output_base_path=settings.generated_path,
    )

    # Set up progress callback with delivery verification
    progress_cb = RedisProgressCallback(job_service, job_id)

    # Run generation
    output_path = Path(params.output_path) if params.output_path else None
    result = await generator.generate_from_session(
        session_id=params.session_id,
        voicebank_name=params.voicebank_name,
        output_path=output_path,
        include_character_txt=params.include_character_txt,
        encoding=params.encoding,
        progress_callback=progress_cb,
    )

    if progress_cb.failed_count > 0:
        logger.warning(
            "Job %s completed but %d progress updates failed delivery",
            job_id,
            progress_cb.failed_count,
        )

    # Serialize the GeneratedVoicebank to a dict, converting Path to str
    result_data = result.model_dump(mode="json")
    return JobResult(success=True, data=result_data)


def _is_retryable(error: Exception) -> bool:
    """Determine whether an error is worth retrying.

    Input/validation errors are not retried since they will fail
    identically on every attempt. Infrastructure errors (GPU failures,
    Redis timeouts, OOM, etc.) are retried.

    Args:
        error: The exception that occurred

    Returns:
        True if the error is potentially transient and worth retrying
    """
    return not isinstance(error, _NON_RETRYABLE_ERRORS)


async def generate_voicebank(ctx: dict[str, Any], job_id: str) -> None:
    """arq task: Generate a voicebank from a recording session.

    Implements retry logic with exponential backoff. On transient failures
    (GPU errors, OOM, Redis timeouts), the task retries up to max_retries
    times. On permanent failure or non-retryable errors, the job is sent
    to the dead-letter queue.

    Args:
        ctx: arq context dict (contains job_service from startup)
        job_id: UUID string of the job to process
    """
    job_uuid = UUID(job_id)
    job_service: JobService = ctx["job_service"]
    settings = get_settings()

    max_retries = settings.worker_max_retries
    base_delay = settings.worker_retry_base_delay
    max_delay = settings.worker_retry_max_delay

    try:
        # Get job — params are already typed via discriminated union
        job = await job_service.get(job_uuid)
        assert isinstance(job.params, GenerateVoicebankParams)
        params = job.params

        # Respect per-job max_retries if set differently from default
        max_retries = job.max_retries

        # Mark as running
        await job_service.update_status(job_uuid, JobStatus.RUNNING)

        # Attempt generation with retries
        attempt = job.retry_count  # Resume from previous retry count
        last_error: str | None = None

        while True:
            try:
                result = await _run_generation(ctx, job_uuid, params)

                # Store success result
                await job_service.set_result(job_uuid, result)

                logger.info(
                    "Generated voicebank '%s': %d samples, %d oto entries",
                    params.voicebank_name,
                    result.data["sample_count"] if result.data else 0,
                    result.data["oto_entries"] if result.data else 0,
                )

                # Send email notification if requested (failures are swallowed)
                if params.notification_email:
                    base_url = settings.base_url.rstrip("/")
                    preview_url = f"{base_url}/api/v1/jobs/{job_uuid}/result"
                    notification_service = NotificationService(settings)
                    await notification_service.notify_job_complete(
                        email=params.notification_email,
                        job_id=str(job_uuid),
                        voice_name=params.voicebank_name,
                        preview_url=preview_url,
                    )

                return  # Success — exit the task

            except Exception as e:
                last_error = str(e)
                attempt += 1

                if not _is_retryable(e):
                    logger.warning(
                        "Job %s failed with non-retryable error: %s",
                        job_id,
                        e,
                    )
                    break  # Go to dead-letter

                if attempt > max_retries:
                    logger.error(
                        "Job %s exhausted all %d retries",
                        job_id,
                        max_retries,
                    )
                    break  # Go to dead-letter

                # Record the retry and back off
                backoff = _calculate_backoff(attempt, base_delay, max_delay)
                logger.warning(
                    "Job %s attempt %d/%d failed (%s), retrying in %.1fs",
                    job_id,
                    attempt,
                    max_retries,
                    e,
                    backoff,
                )
                await job_service.record_retry(job_uuid, last_error)
                await asyncio.sleep(backoff)

                # Re-mark as running for the next attempt
                await job_service.update_status(job_uuid, JobStatus.RUNNING)

        # All retries exhausted or non-retryable — dead-letter
        assert last_error is not None
        await job_service.send_to_dead_letter(job_uuid, last_error)

    except Exception as e:
        # Outer catch: failures in job retrieval, param parsing, or
        # dead-letter submission itself. Store what we can.
        logger.exception("Job %s failed catastrophically", job_id)
        try:
            await job_service.set_result(
                job_uuid,
                JobResult(success=False, error=str(e)),
            )
        except Exception:
            logger.exception("Failed to store error result for job %s", job_id)
