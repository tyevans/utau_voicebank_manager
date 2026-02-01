"""Utility to pre-download ML models for phoneme detection.

Usage:
    uv run python -m src.backend.ml.download_models
"""

import fnmatch
import logging
import sys
import tempfile
import urllib.request
import zipfile
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

# SOFA submodule path (vendor/SOFA)
SOFA_SUBMODULE_PATH = Path(__file__).parent.parent.parent.parent / "vendor" / "SOFA"

# SOFA directory structure (within the submodule)
SOFA_CHECKPOINTS_DIR = SOFA_SUBMODULE_PATH / "ckpt"
SOFA_DICTIONARY_DIR = SOFA_SUBMODULE_PATH / "dictionary"

# Legacy SOFA directory structure (for backward compatibility)
SOFA_BASE_DIR = MODELS_BASE_DIR / "sofa"

# SOFA model download URLs from GitHub releases
SOFA_DOWNLOADS: dict[str, dict[str, dict[str, str | int]]] = {
    "en": {
        "checkpoint": {
            "url": "https://github.com/spicytigermeat/SOFA-Models/releases/download/v1.0.0_en/tgm_en_v100.ckpt",
            "filename": "tgm_en_v100.ckpt",
            "size_mb": 387,
        },
        "dictionary": {
            "url": "https://github.com/spicytigermeat/SOFA-Models/releases/download/v0.0.5/tgm_sofa_dict.txt",
            "filename": "english.txt",
            "size_mb": 3,
        },
    },
    "ja": {
        "zip": {
            "url": "https://github.com/colstone/SOFA_Models/releases/download/JPN-V0.0.2b/SOFA_model_JPN_Ver0.0.2_Beta.zip",
            "filename": "SOFA_model_JPN_Ver0.0.2_Beta.zip",
            "size_mb": 1100,
            "checkpoint_pattern": "*.ckpt",
            "checkpoint_target": "japanese.ckpt",  # Rename to expected name
            "dictionary_pattern": "*.txt",
            "dictionary_target": "japanese.txt",  # Rename to expected name
        },
    },
}

# SOFA model mappings (for status checking)
SOFA_CHECKPOINTS: dict[str, dict[str, str]] = {
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

SOFA_DICTIONARIES: dict[str, dict[str, str]] = {
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


def _create_download_progress_hook(filename: str, expected_size_mb: int) -> callable:
    """Create a progress hook for urllib.request.urlretrieve.

    Args:
        filename: Name of the file being downloaded
        expected_size_mb: Expected file size in megabytes

    Returns:
        A callable that can be used as a reporthook
    """
    last_percent = [-1]  # Use list to allow mutation in closure

    def progress_hook(block_num: int, block_size: int, total_size: int) -> None:
        if total_size > 0:
            downloaded = block_num * block_size
            percent = min(100, int(downloaded * 100 / total_size))
            downloaded_mb = downloaded / (1024 * 1024)
            total_mb = total_size / (1024 * 1024)
        else:
            # Fall back to expected size if server doesn't provide Content-Length
            downloaded = block_num * block_size
            downloaded_mb = downloaded / (1024 * 1024)
            total_mb = expected_size_mb
            percent = min(100, int(downloaded_mb * 100 / total_mb))

        # Only log on significant progress changes (every 10%)
        if percent >= last_percent[0] + 10 or percent == 100:
            last_percent[0] = percent
            logger.info(
                f"  Downloading {filename}: {downloaded_mb:.1f}MB / {total_mb:.1f}MB ({percent}%)"
            )

    return progress_hook


def download_sofa_models() -> tuple[int, int]:
    """Download SOFA models from GitHub releases.

    Downloads checkpoint and dictionary files for languages defined in
    SOFA_DOWNLOADS. Uses streaming downloads with progress indication.

    Returns:
        Tuple of (success_count, failure_count)
    """
    success_count = 0
    failure_count = 0

    for lang_code, lang_models in SOFA_DOWNLOADS.items():
        logger.info(f"Processing SOFA models for language: {lang_code}")

        # Download checkpoint
        ckpt_info = lang_models.get("checkpoint")
        if ckpt_info:
            url = str(ckpt_info["url"])
            filename = str(ckpt_info["filename"])
            expected_size_mb = int(ckpt_info["size_mb"])
            target_path = SOFA_CHECKPOINTS_DIR / filename

            if target_path.exists():
                # Check file size to verify completeness
                actual_size_mb = target_path.stat().st_size / (1024 * 1024)
                if actual_size_mb >= expected_size_mb * 0.9:  # Allow 10% tolerance
                    logger.info(
                        f"  Checkpoint {filename} already exists ({actual_size_mb:.1f}MB), skipping"
                    )
                    success_count += 1
                else:
                    logger.warning(
                        f"  Checkpoint {filename} exists but is incomplete "
                        f"({actual_size_mb:.1f}MB < {expected_size_mb}MB), re-downloading"
                    )
                    if _download_file(url, target_path, filename, expected_size_mb):
                        success_count += 1
                    else:
                        failure_count += 1
            else:
                if _download_file(url, target_path, filename, expected_size_mb):
                    success_count += 1
                else:
                    failure_count += 1

        # Download dictionary
        dict_info = lang_models.get("dictionary")
        if dict_info:
            url = str(dict_info["url"])
            filename = str(dict_info["filename"])
            expected_size_mb = int(dict_info["size_mb"])
            target_path = SOFA_DICTIONARY_DIR / filename

            if target_path.exists():
                logger.info(f"  Dictionary {filename} already exists, skipping")
                success_count += 1
            else:
                if _download_file(url, target_path, filename, expected_size_mb):
                    success_count += 1
                else:
                    failure_count += 1

        # Download and extract zip (contains both checkpoint and dictionary)
        zip_info = lang_models.get("zip")
        if zip_info:
            url = str(zip_info["url"])
            filename = str(zip_info["filename"])
            expected_size_mb = int(zip_info["size_mb"])
            ckpt_pattern = str(zip_info.get("checkpoint_pattern", "*.ckpt"))
            ckpt_target = zip_info.get("checkpoint_target")
            dict_pattern = str(zip_info.get("dictionary_pattern", "*.txt"))
            dict_target = zip_info.get("dictionary_target")

            # Check if we already have the target checkpoint file
            target_ckpt = SOFA_CHECKPOINTS_DIR / ckpt_target if ckpt_target else None
            if target_ckpt and target_ckpt.exists():
                logger.info(
                    f"  Checkpoint {ckpt_target} already exists, skipping zip download"
                )
                success_count += 1
            else:
                if _download_and_extract_zip(
                    url,
                    filename,
                    expected_size_mb,
                    ckpt_pattern,
                    dict_pattern,
                    str(ckpt_target) if ckpt_target else None,
                    str(dict_target) if dict_target else None,
                ):
                    success_count += 1
                else:
                    failure_count += 1

    return success_count, failure_count


def _download_and_extract_zip(
    url: str,
    filename: str,
    expected_size_mb: int,
    ckpt_pattern: str,
    dict_pattern: str,
    ckpt_target: str | None = None,
    dict_target: str | None = None,
) -> bool:
    """Download a zip file and extract checkpoint/dictionary files.

    Args:
        url: URL to download from
        filename: Display name for logging
        expected_size_mb: Expected file size in MB
        ckpt_pattern: Glob pattern for checkpoint files
        dict_pattern: Glob pattern for dictionary files
        ckpt_target: Target filename for checkpoint (rename after extract)
        dict_target: Target filename for dictionary (rename after extract)

    Returns:
        True if download and extraction succeeded, False otherwise
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir) / filename
            logger.info(f"  Starting download: {filename} (~{expected_size_mb}MB)")
            progress_hook = _create_download_progress_hook(filename, expected_size_mb)

            urllib.request.urlretrieve(url, temp_path, reporthook=progress_hook)
            logger.info(f"  Download complete, extracting...")

            with zipfile.ZipFile(temp_path, "r") as zf:
                for member in zf.namelist():
                    basename = Path(member).name
                    if not basename:  # Skip directories
                        continue

                    # Extract checkpoint files
                    if fnmatch.fnmatch(basename, ckpt_pattern):
                        # Use target name if provided, otherwise keep original
                        target_name = ckpt_target if ckpt_target else basename
                        target = SOFA_CHECKPOINTS_DIR / target_name
                        logger.info(f"  Extracting checkpoint: {basename} -> {target_name}")
                        with zf.open(member) as src, open(target, "wb") as dst:
                            dst.write(src.read())

                    # Extract dictionary files
                    elif fnmatch.fnmatch(basename, dict_pattern):
                        # Use target name if provided, otherwise keep original
                        target_name = dict_target if dict_target else basename
                        target = SOFA_DICTIONARY_DIR / target_name
                        logger.info(f"  Extracting dictionary: {basename} -> {target_name}")
                        with zf.open(member) as src, open(target, "wb") as dst:
                            dst.write(src.read())

            logger.info(f"  Successfully extracted: {filename}")
            return True

    except urllib.error.URLError as e:
        logger.error(f"  Failed to download {filename}: Network error - {e}")
        return False
    except zipfile.BadZipFile as e:
        logger.error(f"  Failed to extract {filename}: Invalid zip file - {e}")
        return False
    except Exception as e:
        logger.exception(f"  Failed to process {filename}: {e}")
        return False


def _download_file(
    url: str, target_path: Path, filename: str, expected_size_mb: int
) -> bool:
    """Download a file with progress indication.

    Args:
        url: URL to download from
        target_path: Local path to save the file
        filename: Display name for logging
        expected_size_mb: Expected file size in MB

    Returns:
        True if download succeeded, False otherwise
    """
    try:
        logger.info(f"  Starting download: {filename} (~{expected_size_mb}MB)")
        progress_hook = _create_download_progress_hook(filename, expected_size_mb)

        # Download to a temporary file first, then rename
        temp_path = target_path.with_suffix(".tmp")
        urllib.request.urlretrieve(url, temp_path, reporthook=progress_hook)

        # Rename to final path
        temp_path.rename(target_path)
        logger.info(f"  Successfully downloaded: {filename}")
        return True

    except urllib.error.URLError as e:
        logger.error(f"  Failed to download {filename}: Network error - {e}")
        # Clean up partial download
        temp_path = target_path.with_suffix(".tmp")
        if temp_path.exists():
            temp_path.unlink()
        return False
    except Exception as e:
        logger.exception(f"  Failed to download {filename}: {e}")
        # Clean up partial download
        temp_path = target_path.with_suffix(".tmp")
        if temp_path.exists():
            temp_path.unlink()
        return False


def setup_sofa_directories() -> tuple[int, int]:
    """Set up SOFA directories and download models.

    Checks if the SOFA submodule exists at vendor/SOFA. If not, prints
    instructions to initialize it. If it exists, downloads the required
    model files.

    Returns:
        Tuple of (success_count, failure_count) from model downloads
    """
    logger.info("")
    logger.info("=" * 60)
    logger.info("SOFA (Singing-Oriented Forced Aligner) Setup")
    logger.info("=" * 60)

    # Check if submodule exists
    if not SOFA_SUBMODULE_PATH.exists():
        logger.warning("")
        logger.warning("SOFA submodule not found at: %s", SOFA_SUBMODULE_PATH)
        logger.warning("")
        logger.warning("Please initialize the submodule with:")
        logger.warning("  git submodule update --init")
        logger.warning("")
        logger.warning("Or clone manually:")
        logger.warning("  git clone https://github.com/qiuqiao/SOFA vendor/SOFA")
        logger.warning("")
        return 0, 0

    # Ensure checkpoint and dictionary directories exist
    SOFA_CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    SOFA_DICTIONARY_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("")
    logger.info("SOFA submodule found at: %s", SOFA_SUBMODULE_PATH)
    logger.info("  Checkpoints: %s", SOFA_CHECKPOINTS_DIR)
    logger.info("  Dictionaries: %s", SOFA_DICTIONARY_DIR)

    # Download models
    logger.info("")
    logger.info("Downloading SOFA models from GitHub releases...")
    logger.info("-" * 60)
    success_count, failure_count = download_sofa_models()

    # Check status of all model files (including manually added ones)
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
        logger.info("STATUS: SOFA requires additional models")

    # Print instructions for additional languages
    if missing_checkpoints or missing_dictionaries:
        logger.info("")
        logger.info("=" * 60)
        logger.info("Additional SOFA Models")
        logger.info("=" * 60)
        logger.info("")
        logger.info(
            "Some language models are not yet available for automatic download."
        )
        logger.info("For additional languages, manually download from:")
        logger.info(
            "  https://github.com/qiuqiao/SOFA/discussions/categories/pretrained-model-sharing"
        )
        logger.info("")
        logger.info(f"Place checkpoint files in: {SOFA_CHECKPOINTS_DIR}/")
        logger.info(f"Place dictionary files in: {SOFA_DICTIONARY_DIR}/")

    logger.info("")
    logger.info("=" * 60)

    return success_count, failure_count


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

    # Download HuggingFace models (Wav2Vec2)
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
    logger.info(
        f"HuggingFace models: {success_count} succeeded, {failure_count} failed"
    )

    # Setup SOFA directories and download models
    sofa_success, sofa_failure = setup_sofa_directories()
    success_count += sofa_success
    failure_count += sofa_failure

    logger.info("")
    logger.info("=" * 50)
    logger.info(f"Total downloads: {success_count} succeeded, {failure_count} failed")

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
