"""Centralized FastAPI dependency providers.

All repository and service construction is defined here so that
routers never manually instantiate dependencies or duplicate
configuration constants like base paths.

Path values are read from :func:`~src.backend.config.get_settings` so
that environment-variable overrides (``UVM_VOICEBANKS_PATH``, etc.)
are respected everywhere.
"""

from pathlib import Path
from typing import Annotated

from fastapi import Depends

from src.backend.config import Settings, get_settings
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.oto_service import OtoService
from src.backend.services.recording_session_service import RecordingSessionService
from src.backend.services.voicebank_service import VoicebankService

# ---------------------------------------------------------------------------
# Path dependency providers (derive from Settings — single source of truth)
# ---------------------------------------------------------------------------


def get_voicebanks_path(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Path:
    """Dependency provider for the voicebanks base path."""
    return settings.voicebanks_path


def get_sessions_path(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Path:
    """Dependency provider for the sessions base path."""
    return settings.sessions_path


def get_generated_path(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Path:
    """Dependency provider for the generated output base path."""
    return settings.generated_path


# ---------------------------------------------------------------------------
# Repository providers
# ---------------------------------------------------------------------------


def get_voicebank_repository(
    voicebanks_path: Annotated[Path, Depends(get_voicebanks_path)],
) -> VoicebankRepository:
    """Dependency provider for VoicebankRepository."""
    return VoicebankRepository(voicebanks_path)


def get_oto_repository(
    voicebank_repo: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> OtoRepository:
    """Dependency provider for OtoRepository."""
    return OtoRepository(voicebank_repo)


def get_session_repository(
    sessions_path: Annotated[Path, Depends(get_sessions_path)],
) -> RecordingSessionRepository:
    """Dependency provider for RecordingSessionRepository."""
    return RecordingSessionRepository(sessions_path)


# ---------------------------------------------------------------------------
# Service providers
# ---------------------------------------------------------------------------


def get_voicebank_service(
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> VoicebankService:
    """Dependency provider for VoicebankService."""
    return VoicebankService(repository)


def get_oto_service(
    repository: Annotated[OtoRepository, Depends(get_oto_repository)],
) -> OtoService:
    """Dependency provider for OtoService."""
    return OtoService(repository)


def get_session_service(
    session_repo: Annotated[
        RecordingSessionRepository, Depends(get_session_repository)
    ],
    voicebank_repo: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> RecordingSessionService:
    """Dependency provider for RecordingSessionService."""
    return RecordingSessionService(session_repo, voicebank_repo)
