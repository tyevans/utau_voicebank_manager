"""Utility to pre-download ML models for phoneme detection.

Usage:
    uv run python -m src.backend.ml.download_models
"""

import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Models to download
MODELS = [
    {
        "name": "facebook/wav2vec2-lv-60-espeak-cv-ft",
        "description": "Wav2Vec2 with eSpeak phoneme output (IPA)",
        "cache_subdir": "wav2vec2",
    },
]

# Base directory for model cache
# Path: src/backend/ml/download_models.py -> project root
MODELS_BASE_DIR = Path(__file__).parent.parent.parent.parent / "models"


def download_wav2vec2_model(
    model_name: str,
    cache_dir: Path,
) -> bool:
    """Download a Wav2Vec2 model and processor.

    Args:
        model_name: HuggingFace model identifier
        cache_dir: Directory to cache the model

    Returns:
        True if successful, False otherwise
    """
    try:
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        logger.info(f"Downloading processor for {model_name}...")
        Wav2Vec2Processor.from_pretrained(
            model_name,
            cache_dir=str(cache_dir),
        )
        logger.info("Processor downloaded successfully")

        logger.info(f"Downloading model for {model_name}...")
        logger.info("This may take a few minutes (~2GB download)...")
        Wav2Vec2ForCTC.from_pretrained(
            model_name,
            cache_dir=str(cache_dir),
        )
        logger.info("Model downloaded successfully")

        return True

    except Exception as e:
        logger.exception(f"Failed to download model {model_name}: {e}")
        return False


def main() -> int:
    """Download all required ML models.

    Returns:
        Exit code (0 for success, 1 for any failures)
    """
    logger.info("UTAU Voicebank Manager - Model Downloader")
    logger.info("=" * 50)

    # Ensure base directory exists
    MODELS_BASE_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Models will be cached in: {MODELS_BASE_DIR}")

    success_count = 0
    failure_count = 0

    for model_info in MODELS:
        model_name = model_info["name"]
        description = model_info["description"]
        cache_subdir = model_info["cache_subdir"]

        logger.info("")
        logger.info(f"Model: {model_name}")
        logger.info(f"Description: {description}")

        cache_dir = MODELS_BASE_DIR / cache_subdir
        cache_dir.mkdir(parents=True, exist_ok=True)

        if download_wav2vec2_model(model_name, cache_dir):
            success_count += 1
        else:
            failure_count += 1

    logger.info("")
    logger.info("=" * 50)
    logger.info(f"Download complete: {success_count} succeeded, {failure_count} failed")

    if failure_count > 0:
        logger.warning(
            "Some models failed to download. "
            "They will be downloaded on first use, which may cause a delay."
        )
        return 1

    logger.info("All models ready for use!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
