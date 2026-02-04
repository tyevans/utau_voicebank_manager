"""arq worker settings.

Run the worker with:
    arq src.backend.worker.settings.WorkerSettings
"""

import logging
from typing import Any

from arq.connections import RedisSettings

from src.backend.config import get_settings
from src.backend.worker.tasks.generate_voicebank import generate_voicebank

logger = logging.getLogger(__name__)


async def startup(ctx: dict[str, Any]) -> None:
    """Worker startup: connect to Redis, create services, preload models."""
    from redis.asyncio import Redis

    from src.backend.services.job_service import JobService

    settings = get_settings()

    # Create Redis connection for job service
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    ctx["redis"] = redis
    ctx["job_service"] = JobService(redis, ttl_seconds=settings.job_ttl_seconds)

    logger.info("Worker started, connected to Redis at %s", settings.redis_url)

    # Preload ML models to avoid cold-start latency
    try:
        from src.backend.ml.oto_suggester import get_oto_suggester

        get_oto_suggester()
        logger.info("ML models preloaded")
    except Exception:
        logger.warning(
            "Failed to preload ML models (will load on first use)", exc_info=True
        )


async def shutdown(ctx: dict[str, Any]) -> None:
    """Worker shutdown: close Redis connection."""
    redis = ctx.get("redis")
    if redis is not None:
        await redis.aclose()
        logger.info("Worker shut down, Redis connection closed")


class WorkerSettings:
    """arq WorkerSettings for the GPU worker."""

    # Task functions
    functions = [generate_voicebank]

    # Worker config
    max_jobs = 1  # GPU-bound, one task at a time
    job_timeout = 3600  # 1 hour max per job
    max_tries = 1  # Don't auto-retry GPU tasks

    # Lifecycle hooks
    on_startup = startup
    on_shutdown = shutdown

    # Redis connection — parsed from settings at import time
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
