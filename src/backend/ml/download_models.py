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

# SOFA directory structure
SOFA_BASE_DIR = MODELS_BASE_DIR / "sofa"
SOFA_CHECKPOINTS_DIR = SOFA_BASE_DIR / "checkpoints"
SOFA_DICTIONARY_DIR = SOFA_BASE_DIR / "dictionary"

# SOFA model mappings (must be manually downloaded)
SOFA_CHECKPOINTS = {
    "en": {
        "file": "tgm_en_v100.ckpt",
        "language": "English",
    },
    "zh": {
        "file": "mandarin.ckpt",
        "language": "Mandarin Chinese",
    },
    "ko": {
        "file": "korean.ckpt",
        "language": "Korean",
    },
    "fr": {
        "file": "french.ckpt",
        "language": "French",
    },
    "ja": {
        "file": "japanese.ckpt",
        "language": "Japanese",
    },
}

SOFA_DICTIONARIES = {
    "en": {
        "file": "english.txt",
        "language": "English",
    },
    "zh": {
        "file": "opencpop-extension.txt",
        "language": "Mandarin Chinese",
    },
    "ko": {
        "file": "korean.txt",
        "language": "Korean",
    },
    "fr": {
        "file": "french.txt",
        "language": "French",
    },
    "ja": {
        "file": "japanese.txt",
        "language": "Japanese",
    },
}


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


def setup_sofa_directories() -> None:
    """Create SOFA directory structure and print setup instructions.

    SOFA models are distributed via GitHub discussions as .ckpt files
    and must be manually downloaded. This function creates the necessary
    directory structure and provides setup guidance.
    """
    logger.info("")
    logger.info("=" * 60)
    logger.info("SOFA (Singing-Oriented Forced Aligner) Setup")
    logger.info("=" * 60)

    # Create directory structure
    SOFA_CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    SOFA_DICTIONARY_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("")
    logger.info("Created SOFA directory structure:")
    logger.info(f"  Checkpoints: {SOFA_CHECKPOINTS_DIR}")
    logger.info(f"  Dictionaries: {SOFA_DICTIONARY_DIR}")

    # Check status of existing files
    logger.info("")
    logger.info("Checking SOFA model status...")
    logger.info("-" * 60)

    available_checkpoints: list[str] = []
    missing_checkpoints: list[str] = []
    available_dictionaries: list[str] = []
    missing_dictionaries: list[str] = []

    for _lang_code, info in SOFA_CHECKPOINTS.items():
        ckpt_path = SOFA_CHECKPOINTS_DIR / info["file"]
        if ckpt_path.exists():
            available_checkpoints.append(f"  [OK] {info['language']}: {info['file']}")
        else:
            missing_checkpoints.append(f"  [--] {info['language']}: {info['file']}")

    for _lang_code, info in SOFA_DICTIONARIES.items():
        dict_path = SOFA_DICTIONARY_DIR / info["file"]
        if dict_path.exists():
            available_dictionaries.append(f"  [OK] {info['language']}: {info['file']}")
        else:
            missing_dictionaries.append(f"  [--] {info['language']}: {info['file']}")

    logger.info("")
    logger.info("Checkpoint files (.ckpt):")
    for line in available_checkpoints + missing_checkpoints:
        logger.info(line)

    logger.info("")
    logger.info("Dictionary files (.txt):")
    for line in available_dictionaries + missing_dictionaries:
        logger.info(line)

    # Determine overall status
    has_any_checkpoint = len(available_checkpoints) > 0
    has_any_dictionary = len(available_dictionaries) > 0

    logger.info("")
    logger.info("-" * 60)

    if has_any_checkpoint and has_any_dictionary:
        logger.info("STATUS: SOFA is partially or fully configured")
        logger.info(
            f"  Available checkpoints: {len(available_checkpoints)}/{len(SOFA_CHECKPOINTS)}"
        )
        logger.info(
            f"  Available dictionaries: {len(available_dictionaries)}/{len(SOFA_DICTIONARIES)}"
        )
    else:
        logger.info("STATUS: SOFA requires manual setup")

    # Print setup instructions
    logger.info("")
    logger.info("=" * 60)
    logger.info("SOFA Setup Instructions")
    logger.info("=" * 60)
    logger.info("")
    logger.info("SOFA models are NOT available via HuggingFace and must be")
    logger.info("manually downloaded from GitHub.")
    logger.info("")
    logger.info("Step 1: Clone the SOFA repository")
    logger.info("  git clone https://github.com/qiuqiao/SOFA")
    logger.info("")
    logger.info("Step 2: Download pretrained models")
    logger.info(
        "  Visit: https://github.com/qiuqiao/SOFA/discussions/categories/pretrained-model-sharing"
    )
    logger.info("  Download the .ckpt files for your target languages")
    logger.info("")
    logger.info("Step 3: Place files in the correct locations")
    logger.info(f"  Checkpoints: {SOFA_CHECKPOINTS_DIR}/")
    for _lang_code, info in SOFA_CHECKPOINTS.items():
        logger.info(f"    - {info['file']} ({info['language']})")
    logger.info("")
    logger.info(f"  Dictionaries: {SOFA_DICTIONARY_DIR}/")
    for _lang_code, info in SOFA_DICTIONARIES.items():
        logger.info(f"    - {info['file']} ({info['language']})")
    logger.info("")
    logger.info("Step 4: Set SOFA_PATH environment variable")
    logger.info("  export SOFA_PATH=/path/to/your/SOFA")
    logger.info("")
    logger.info("  Add to ~/.bashrc or ~/.zshrc for persistence:")
    logger.info("  echo 'export SOFA_PATH=/path/to/your/SOFA' >> ~/.bashrc")
    logger.info("")
    logger.info("=" * 60)


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

    # Setup SOFA directories and print instructions
    setup_sofa_directories()

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
