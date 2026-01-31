"""API router for ML-powered phoneme detection."""

import contextlib
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, status

from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.phoneme_detector import (
    AudioProcessingError,
    ModelNotLoadedError,
    get_phoneme_detector,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml", tags=["ml"])

# Allowed audio file extensions
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}

# Maximum file size (50MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


def validate_audio_file(file: UploadFile) -> None:
    """Validate uploaded audio file.

    Args:
        file: Uploaded file object

    Raises:
        HTTPException: If file is invalid
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required",
        )

    # Check extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )


@router.post("/phonemes/detect", response_model=list[PhonemeSegment])
async def detect_phonemes(file: UploadFile) -> list[PhonemeSegment]:
    """Detect phonemes with timestamps from an uploaded audio file.

    Uploads an audio file and returns a list of detected phonemes with
    their start/end times and confidence scores.

    Args:
        file: Audio file (WAV, MP3, FLAC, OGG, or M4A)

    Returns:
        List of detected phoneme segments with timestamps

    Raises:
        HTTPException: If file is invalid or processing fails
    """
    # Validate the uploaded file
    validate_audio_file(file)

    # Read file content with size check
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB",
        )

    # Save to temporary file for processing
    ext = Path(file.filename).suffix.lower() if file.filename else ".wav"

    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = Path(tmp_file.name)

        # Run phoneme detection
        detector = get_phoneme_detector()
        result = await detector.detect_phonemes(tmp_path)

        logger.info(
            f"Detected {result.phoneme_count} phonemes in {result.audio_duration_ms:.1f}ms audio"
        )

        return result.segments

    except ModelNotLoadedError as e:
        logger.exception("Model not loaded")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ML model not available: {e}. Please try again later.",
        ) from e

    except AudioProcessingError as e:
        logger.exception("Audio processing failed")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process audio file: {e}",
        ) from e

    except Exception as e:
        logger.exception("Unexpected error during phoneme detection")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        ) from e

    finally:
        # Clean up temporary file
        if "tmp_path" in locals():
            with contextlib.suppress(OSError):
                tmp_path.unlink()


@router.get("/status")
async def ml_status() -> dict[str, str | bool]:
    """Check ML service status and model availability.

    Returns:
        Dictionary with status information
    """
    import torch

    return {
        "status": "available",
        "cuda_available": torch.cuda.is_available(),
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "model": "facebook/wav2vec2-lv-60-espeak-cv-ft",
    }
