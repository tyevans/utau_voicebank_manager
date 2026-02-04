"""Progress callback adapter for worker tasks.

Bridges the sync callback signature expected by VoicebankGenerator
(Callable[[float, str], None]) to async Redis progress writes.
"""

import asyncio
import logging
from uuid import UUID

from src.backend.services.job_service import JobService

logger = logging.getLogger(__name__)


class RedisProgressCallback:
    """Adapter that writes progress updates to Redis.

    Wraps a JobService to provide the Callable[[float, str], None]
    interface expected by VoicebankGenerator.generate_from_session().

    Progress writes are fire-and-forget via asyncio.create_task()
    so they don't block the main task execution.
    """

    def __init__(self, job_service: JobService, job_id: UUID) -> None:
        self._job_service = job_service
        self._job_id = job_id

    def __call__(self, percent: float, message: str) -> None:
        """Write progress to Redis via fire-and-forget task."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                self._job_service.update_progress(self._job_id, percent, message)
            )
        except RuntimeError:
            # No running loop (shouldn't happen in worker context)
            logger.warning(
                "No event loop for progress update: %.1f%% %s", percent, message
            )
