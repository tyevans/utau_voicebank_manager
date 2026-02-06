"""Centralized application settings via pydantic-settings.

Loads configuration from environment variables with the UVM_ prefix.
All paths default to local development values. Override via environment
variables for Docker/production deployment.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All paths default to local development values. Override via
    environment variables (prefixed with UVM_) for Docker/production
    deployment.

    Examples:
        Override Redis URL::

            UVM_REDIS_URL=redis://redis:6379 uv run fastapi dev

        Override data paths::

            UVM_VOICEBANKS_PATH=/mnt/data/voicebanks uv run fastapi dev
    """

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Data paths
    data_path: Path = Path("data")
    voicebanks_path: Path = Path("data/voicebanks")
    sessions_path: Path = Path("data/sessions")
    generated_path: Path = Path("data/generated")
    models_path: Path = Path("models")

    # Job settings
    job_ttl_seconds: int = 7 * 24 * 3600  # 7 days

    # Worker retry settings
    worker_max_retries: int = 3
    worker_retry_base_delay: float = 5.0  # seconds, doubled each retry
    worker_retry_max_delay: float = 120.0  # cap for exponential backoff

    # SMTP email notification settings
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "noreply@example.com"
    smtp_tls: bool = True
    base_url: str = "http://localhost:5173"

    model_config = {"env_prefix": "UVM_"}


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings singleton.

    Uses lru_cache so the Settings object is created once and reused
    across all FastAPI Depends injections.
    """
    return Settings()
