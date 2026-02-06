"""Progress callback adapter for worker tasks.

Bridges the sync callback signature expected by VoicebankGenerator
(Callable[[float, str], None]) to async Redis progress writes.

Progress writes are verified with retries and timeouts rather than
fire-and-forget, to ensure delivery.
"""

import asyncio
import logging
from uuid import UUID

from src.backend.services.job_service import JobService

logger = logging.getLogger(__name__)

# Defaults for progress delivery
_DEFAULT_TIMEOUT_SECONDS: float = 5.0
_DEFAULT_MAX_RETRIES: int = 2
_DEFAULT_RETRY_DELAY_SECONDS: float = 0.5


class ProgressDeliveryError(Exception):
    """Raised when a progress update cannot be delivered after retries."""


class RedisProgressCallback:
    """Adapter that writes progress updates to Redis with delivery verification.

    Wraps a JobService to provide the Callable[[float, str], None]
    interface expected by VoicebankGenerator.generate_from_session().

    Each progress write is awaited with a timeout and retried on failure,
    rather than using fire-and-forget. Failed deliveries are logged but
    do not abort the main task.
    """

    def __init__(
        self,
        job_service: JobService,
        job_id: UUID,
        *,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        retry_delay: float = _DEFAULT_RETRY_DELAY_SECONDS,
    ) -> None:
        self._job_service = job_service
        self._job_id = job_id
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._failed_count = 0

    @property
    def failed_count(self) -> int:
        """Number of progress updates that could not be delivered."""
        return self._failed_count

    def __call__(self, percent: float, message: str) -> None:
        """Write progress to Redis with delivery verification.

        Schedules the async write and waits for confirmation via
        an asyncio task. On failure, retries up to max_retries times.
        If all retries fail, logs a warning but does not raise — the
        main task should not be aborted due to a progress write failure.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._deliver(percent, message))
        except RuntimeError:
            # No running loop (shouldn't happen in worker context)
            logger.warning(
                "No event loop for progress update: %.1f%% %s", percent, message
            )
            self._failed_count += 1

    async def _deliver(self, percent: float, message: str) -> None:
        """Attempt to deliver a progress update with retries.

        Each attempt is bounded by the configured timeout. Retries
        use a fixed delay between attempts.
        """
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            try:
                await asyncio.wait_for(
                    self._job_service.update_progress(self._job_id, percent, message),
                    timeout=self._timeout,
                )
                return  # Success
            except TimeoutError:
                last_error = TimeoutError(
                    f"Progress write timed out after {self._timeout}s"
                )
                logger.warning(
                    "Progress delivery timeout (attempt %d/%d) for job %s: %.1f%% %s",
                    attempt,
                    self._max_retries,
                    self._job_id,
                    percent,
                    message,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Progress delivery failed (attempt %d/%d) for job %s: %s",
                    attempt,
                    self._max_retries,
                    self._job_id,
                    exc,
                )

            if attempt < self._max_retries:
                await asyncio.sleep(self._retry_delay)

        # All retries exhausted — log but don't abort the main task
        self._failed_count += 1
        logger.error(
            "Progress delivery permanently failed for job %s at %.1f%%: %s",
            self._job_id,
            percent,
            last_error,
        )
