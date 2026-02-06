"""File-based persistence for alignment configuration.

Stores alignment config as a JSON file so that all workers in a
multi-worker deployment share the same configuration state.
"""

import json
import logging
from pathlib import Path

from src.backend.config import get_settings
from src.backend.domain.alignment_config import AlignmentConfig

logger = logging.getLogger(__name__)


def _get_config_path() -> Path:
    """Return the config file path, creating parent directories if needed.

    The path is derived from :func:`~src.backend.config.get_settings` so
    environment-variable overrides (``UVM_DATA_PATH``) are respected.
    """
    config_path = get_settings().data_path / "alignment_config.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    return config_path


def load_alignment_config() -> AlignmentConfig:
    """Load the alignment config from disk.

    Returns the persisted config if the file exists and is valid JSON,
    otherwise returns the default AlignmentConfig.

    Returns:
        The current AlignmentConfig.
    """
    path = _get_config_path()
    if not path.exists():
        return AlignmentConfig()

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        return AlignmentConfig.model_validate(data)
    except (json.JSONDecodeError, ValueError, OSError) as exc:
        logger.warning("Failed to load alignment config from %s: %s", path, exc)
        return AlignmentConfig()


def save_alignment_config(config: AlignmentConfig) -> None:
    """Persist the alignment config to disk.

    Writes atomically by writing to a temporary file first, then
    renaming to avoid partial reads from concurrent workers.

    Args:
        config: The AlignmentConfig to persist.
    """
    path = _get_config_path()
    tmp_path = path.with_suffix(".json.tmp")

    try:
        tmp_path.write_text(
            json.dumps(config.model_dump(), indent=2) + "\n",
            encoding="utf-8",
        )
        tmp_path.replace(path)
    except OSError:
        logger.exception("Failed to save alignment config to %s", path)
        raise
