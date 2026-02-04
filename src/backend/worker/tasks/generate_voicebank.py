"""arq task for generating voicebanks from recording sessions."""

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
from src.backend.services.recording_session_service import RecordingSessionService
from src.backend.services.voicebank_generator import VoicebankGenerator
from src.backend.worker.progress import RedisProgressCallback

logger = logging.getLogger(__name__)


async def generate_voicebank(ctx: dict[str, Any], job_id: str) -> None:
    """arq task: Generate a voicebank from a recording session.

    Args:
        ctx: arq context dict (contains job_service from startup)
        job_id: UUID string of the job to process
    """
    job_uuid = UUID(job_id)
    job_service: JobService = ctx["job_service"]
    settings = get_settings()

    try:
        # Get job and parse params
        job = await job_service.get(job_uuid)
        params = GenerateVoicebankParams.model_validate(job.params)

        # Mark as running
        await job_service.update_status(job_uuid, JobStatus.RUNNING)

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

        # Set up progress callback
        progress_cb = RedisProgressCallback(job_service, job_uuid)

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

        # Store success result
        # Serialize the GeneratedVoicebank to a dict, converting Path to str
        result_data = result.model_dump(mode="json")
        await job_service.set_result(
            job_uuid,
            JobResult(success=True, data=result_data),
        )

        logger.info(
            "Generated voicebank '%s': %d samples, %d oto entries",
            params.voicebank_name,
            result.sample_count,
            result.oto_entries,
        )

    except Exception as e:
        logger.exception("Job %s failed", job_id)
        try:
            await job_service.set_result(
                job_uuid,
                JobResult(success=False, error=str(e)),
            )
        except Exception:
            logger.exception("Failed to store error result for job %s", job_id)
