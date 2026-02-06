"""Centralized ML model registry with version pinning and integrity metadata.

All ML models used in the project are registered here with their exact
versions (commit hashes, checkpoint filenames, minimum library versions).
This prevents silent behavior changes when upstream models are updated.

Usage:
    from src.backend.ml.model_registry import MODEL_REGISTRY, get_model_config

    config = get_model_config("wav2vec2-phoneme")
    model = Wav2Vec2ForCTC.from_pretrained(
        config.model_id,
        revision=config.revision,
        cache_dir=str(config.cache_dir),
    )
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Project root for relative paths
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent


@dataclass(frozen=True)
class ModelConfig:
    """Configuration for a single ML model.

    Attributes:
        name: Human-readable name for logging and display
        model_id: HuggingFace model ID or pipeline identifier
        revision: Pinned git commit hash for HuggingFace models.
                 Use None for models versioned by other means (e.g. torchaudio bundles).
        cache_dir: Local directory for cached model weights
        description: Brief description of the model's purpose
        memory_mb: Approximate GPU memory usage in megabytes
        min_library_version: Minimum required version of the host library
                            (e.g. "2.0.0" for torchaudio)
        expected_files: Optional list of expected files in cache for integrity checking.
                       These are checked after download to verify completeness.
        expected_size_mb: Optional expected total size in MB for rough integrity check.
    """

    name: str
    model_id: str
    revision: str | None
    cache_dir: Path
    description: str = ""
    memory_mb: int = 0
    min_library_version: str | None = None
    expected_files: tuple[str, ...] = field(default_factory=tuple)
    expected_size_mb: int | None = None


# ---------------------------------------------------------------------------
# Model Registry
# ---------------------------------------------------------------------------
# Each entry is keyed by a short stable identifier used throughout the codebase.
# To update a model version:
#   1. Change the `revision` to the new commit hash
#   2. Run `script/models` to re-download
#   3. Run tests to verify behavior hasn't regressed

MODEL_REGISTRY: dict[str, ModelConfig] = {
    # -----------------------------------------------------------------------
    # HuggingFace models (pinned by commit hash)
    # -----------------------------------------------------------------------
    "wav2vec2-phoneme": ModelConfig(
        name="Wav2Vec2 Phoneme (eSpeak IPA)",
        model_id="facebook/wav2vec2-lv-60-espeak-cv-ft",
        revision="ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4",
        cache_dir=_PROJECT_ROOT / "models" / "wav2vec2",
        description="Wav2Vec2 with eSpeak phoneme output (IPA). Used for "
        "zero-shot phoneme detection and CTC forced alignment.",
        memory_mb=2000,
        expected_files=(
            "config.json",
            "preprocessor_config.json",
        ),
        expected_size_mb=1200,
    ),
    # -----------------------------------------------------------------------
    # TorchAudio bundled models (pinned by library version)
    # -----------------------------------------------------------------------
    "mms-fa": ModelConfig(
        name="MMS Forced Alignment",
        model_id="torchaudio.pipelines.MMS_FA",
        revision=None,  # Versioned by torchaudio package version
        cache_dir=_PROJECT_ROOT / "models" / "torchaudio",
        description="Meta MMS forced alignment model for 1100+ languages. "
        "Bundled with torchaudio, version locked to torchaudio release.",
        memory_mb=500,
        min_library_version="2.1.0",
    ),
    # -----------------------------------------------------------------------
    # SOFA models (local checkpoints, versioned by filename)
    # -----------------------------------------------------------------------
    "sofa-en": ModelConfig(
        name="SOFA English",
        model_id="tgm_en_v100.ckpt",
        revision=None,  # Local checkpoint, versioned by filename
        cache_dir=_PROJECT_ROOT / "vendor" / "SOFA" / "ckpt",
        description="SOFA singing-oriented forced aligner for English.",
        memory_mb=400,
        expected_size_mb=387,
    ),
    "sofa-ja": ModelConfig(
        name="SOFA Japanese",
        model_id="japanese.ckpt",
        revision=None,  # Local checkpoint, versioned by filename
        cache_dir=_PROJECT_ROOT / "vendor" / "SOFA" / "ckpt",
        description="SOFA singing-oriented forced aligner for Japanese.",
        memory_mb=400,
    ),
}


# ---------------------------------------------------------------------------
# SOFA cache TTL (configurable via environment variable)
# ---------------------------------------------------------------------------
# Default: 3600 seconds (60 minutes). The previous 5-minute TTL was too
# short for batch processing jobs that run many files sequentially.
#
# Set SOFA_CACHE_TTL_SECONDS environment variable to override.
DEFAULT_SOFA_CACHE_TTL_SECONDS: int = 3600


def get_sofa_cache_ttl() -> int:
    """Get the SOFA model cache TTL in seconds.

    Reads from the SOFA_CACHE_TTL_SECONDS environment variable,
    falling back to DEFAULT_SOFA_CACHE_TTL_SECONDS (3600 = 60 minutes).

    Returns:
        Cache TTL in seconds
    """
    env_val = os.environ.get("SOFA_CACHE_TTL_SECONDS")
    if env_val is not None:
        try:
            ttl = int(env_val)
            if ttl > 0:
                return ttl
            logger.warning(
                f"SOFA_CACHE_TTL_SECONDS must be positive, got {ttl}. "
                f"Using default: {DEFAULT_SOFA_CACHE_TTL_SECONDS}"
            )
        except ValueError:
            logger.warning(
                f"Invalid SOFA_CACHE_TTL_SECONDS value: {env_val!r}. "
                f"Using default: {DEFAULT_SOFA_CACHE_TTL_SECONDS}"
            )
    return DEFAULT_SOFA_CACHE_TTL_SECONDS


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_model_config(model_key: str) -> ModelConfig:
    """Look up a model configuration by its registry key.

    Args:
        model_key: Short identifier (e.g. "wav2vec2-phoneme", "mms-fa")

    Returns:
        ModelConfig for the requested model

    Raises:
        KeyError: If model_key is not in the registry
    """
    if model_key not in MODEL_REGISTRY:
        available = ", ".join(sorted(MODEL_REGISTRY.keys()))
        raise KeyError(f"Unknown model key: {model_key!r}. Available: {available}")
    return MODEL_REGISTRY[model_key]


def verify_model_cache(model_key: str) -> tuple[bool, list[str]]:
    """Verify that a model's cached files exist and pass basic integrity checks.

    Checks:
    1. Cache directory exists
    2. Expected files are present (if specified in config)
    3. Total size is within 10% of expected (if specified in config)

    Args:
        model_key: Short identifier from the registry

    Returns:
        Tuple of (is_valid, issues) where issues is a list of problem descriptions.
        Empty issues list means the cache looks good.
    """
    config = get_model_config(model_key)
    issues: list[str] = []

    if not config.cache_dir.exists():
        issues.append(f"Cache directory does not exist: {config.cache_dir}")
        return False, issues

    # For HuggingFace models, check within the snapshots directory
    if config.revision is not None:
        # HF cache structure: models--org--name/snapshots/<hash>/
        hf_model_dir = (
            config.cache_dir / f"models--{config.model_id.replace('/', '--')}"
        )
        snapshot_dir = hf_model_dir / "snapshots" / config.revision

        if not snapshot_dir.exists():
            # Check if any snapshot exists (might be a different revision)
            snapshots_parent = hf_model_dir / "snapshots"
            if snapshots_parent.exists():
                existing = list(snapshots_parent.iterdir())
                if existing:
                    existing_hashes = [d.name for d in existing if d.is_dir()]
                    issues.append(
                        f"Expected revision {config.revision} not found. "
                        f"Found: {existing_hashes}"
                    )
                else:
                    issues.append(f"No snapshots found in {snapshots_parent}")
            else:
                issues.append(f"HuggingFace cache structure not found: {hf_model_dir}")
            return False, issues

        # Check expected files within the snapshot
        for expected_file in config.expected_files:
            file_path = snapshot_dir / expected_file
            if not file_path.exists():
                issues.append(f"Expected file missing: {expected_file}")

    else:
        # For local checkpoints (SOFA), check the file directly
        if config.model_id.endswith(".ckpt"):
            ckpt_path = config.cache_dir / config.model_id
            if not ckpt_path.exists():
                issues.append(f"Checkpoint file missing: {ckpt_path}")
            elif config.expected_size_mb is not None:
                actual_mb = ckpt_path.stat().st_size / (1024 * 1024)
                if actual_mb < config.expected_size_mb * 0.9:
                    issues.append(
                        f"Checkpoint size {actual_mb:.1f}MB is less than "
                        f"expected {config.expected_size_mb}MB (possible incomplete download)"
                    )

    is_valid = len(issues) == 0
    return is_valid, issues


def log_registry_status() -> None:
    """Log the status of all registered models.

    Useful for diagnostics and startup logging.
    """
    logger.info("ML Model Registry Status:")
    logger.info("-" * 60)

    for key, config in MODEL_REGISTRY.items():
        is_valid, issues = verify_model_cache(key)
        status = "OK" if is_valid else "MISSING/INVALID"
        rev_str = config.revision[:12] if config.revision else "n/a"

        logger.info(
            f"  [{status:>15}] {key}: {config.model_id} "
            f"(rev: {rev_str}, ~{config.memory_mb}MB)"
        )
        for issue in issues:
            logger.warning(f"    - {issue}")

    logger.info("-" * 60)
