"""Redis-backed job lifecycle service.

Manages job creation, status tracking, and progress updates.
Job data is stored in Redis with a configurable TTL (default 7 days).
Progress is stored in a separate key for fast frequent writes
without deserializing the full job record.
"""

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from redis.asyncio import Redis

from src.backend.domain.job import (
    Job,
    JobProgress,
    JobResult,
    JobStatus,
    JobType,
)

logger = logging.getLogger(__name__)

# Redis key prefixes
_JOB_KEY = "uvm:job:{id}"
_PROGRESS_KEY = "uvm:job_progress:{id}"


class JobNotFoundError(Exception):
    """Raised when a job is not found in Redis."""


class JobService:
    """Redis-backed job lifecycle management.

    Handles the full job lifecycle:
    - submit: create and store a new QUEUED job
    - get: retrieve job with merged progress
    - update_status: transition job status
    - update_progress: write progress to separate key
    - set_result: store final result (success or failure)
    """

    def __init__(self, redis: Redis, ttl_seconds: int = 7 * 24 * 3600) -> None:
        """Initialize service with Redis client and TTL.

        Args:
            redis: Async Redis client instance
            ttl_seconds: Time-to-live for job keys in seconds (default 7 days)
        """
        self._redis = redis
        self._ttl = ttl_seconds

    async def submit(
        self,
        job_type: JobType,
        params: dict[str, Any] | None = None,
    ) -> Job:
        """Create and store a new job in QUEUED status.

        Args:
            job_type: The kind of work this job performs
            params: Job input parameters

        Returns:
            The created Job with its generated ID
        """
        job = Job(type=job_type, params=params or {})
        key = _JOB_KEY.format(id=job.id)
        await self._redis.set(key, job.model_dump_json(), ex=self._ttl)
        logger.info("Submitted job %s type=%s", job.id, job.type.value)
        return job

    async def get(self, job_id: UUID) -> Job:
        """Get a job by ID, merging in the latest progress.

        Reads the main job record and the separate progress key,
        combining them into a single Job model.

        Args:
            job_id: Unique job identifier

        Returns:
            Job with current progress merged in

        Raises:
            JobNotFoundError: If the job doesn't exist in Redis
        """
        key = _JOB_KEY.format(id=job_id)
        data = await self._redis.get(key)
        if data is None:
            raise JobNotFoundError(f"Job {job_id} not found")

        job = Job.model_validate_json(data)

        # Merge progress from separate key
        progress_key = _PROGRESS_KEY.format(id=job_id)
        progress_data = await self._redis.get(progress_key)
        if progress_data is not None:
            job.progress = JobProgress.model_validate_json(progress_data)

        return job

    async def update_status(self, job_id: UUID, status: JobStatus) -> Job:
        """Update a job's status.

        Args:
            job_id: Unique job identifier
            status: New status to set

        Returns:
            Updated Job record

        Raises:
            JobNotFoundError: If the job doesn't exist in Redis
        """
        key = _JOB_KEY.format(id=job_id)
        data = await self._redis.get(key)
        if data is None:
            raise JobNotFoundError(f"Job {job_id} not found")

        job = Job.model_validate_json(data)
        job.status = status
        job.updated_at = datetime.now(UTC)
        await self._redis.set(key, job.model_dump_json(), ex=self._ttl)

        logger.info("Job %s status -> %s", job_id, status.value)
        return job

    async def update_progress(
        self, job_id: UUID, percent: float, message: str = ""
    ) -> None:
        """Write a progress update to the separate progress key.

        Uses a separate Redis key to avoid deserializing the full job
        record on every progress tick. This is called frequently by
        the worker during long-running tasks.

        Args:
            job_id: Unique job identifier
            percent: Completion percentage (0-100)
            message: Human-readable status message
        """
        progress = JobProgress(percent=percent, message=message)
        progress_key = _PROGRESS_KEY.format(id=job_id)
        await self._redis.set(progress_key, progress.model_dump_json(), ex=self._ttl)

    async def set_result(
        self,
        job_id: UUID,
        result: JobResult,
    ) -> Job:
        """Store the final result and set terminal status.

        Sets status to COMPLETED if result.success, else FAILED.
        Merges the final progress snapshot into the job record and
        cleans up the separate progress key.

        Args:
            job_id: Unique job identifier
            result: Final job result (success or failure)

        Returns:
            Updated Job record with result and terminal status

        Raises:
            JobNotFoundError: If the job doesn't exist in Redis
        """
        key = _JOB_KEY.format(id=job_id)
        data = await self._redis.get(key)
        if data is None:
            raise JobNotFoundError(f"Job {job_id} not found")

        job = Job.model_validate_json(data)
        job.result = result
        job.status = JobStatus.COMPLETED if result.success else JobStatus.FAILED
        job.updated_at = datetime.now(UTC)

        # Merge final progress into the job record
        progress_key = _PROGRESS_KEY.format(id=job_id)
        progress_data = await self._redis.get(progress_key)
        if progress_data is not None:
            job.progress = JobProgress.model_validate_json(progress_data)

        await self._redis.set(key, job.model_dump_json(), ex=self._ttl)

        # Clean up separate progress key
        await self._redis.delete(progress_key)

        status_str = "completed" if result.success else "failed"
        logger.info("Job %s %s", job_id, status_str)
        return job
