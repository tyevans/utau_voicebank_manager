"""API router for ML-powered phoneme detection and oto suggestions."""

import contextlib
import logging
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status

from src.backend.domain.batch_oto import BatchOtoRequest, BatchOtoResult
from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.oto_suggester import OtoSuggester, get_oto_suggester
from src.backend.ml.phoneme_detector import (
    AudioProcessingError,
    ModelNotLoadedError,
    get_phoneme_detector,
)
from src.backend.ml.sofa_aligner import get_sofa_aligner, is_sofa_available
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.batch_oto_service import BatchOtoService
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml", tags=["ml"])

# Allowed audio file extensions
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}

# Maximum file size (50MB)
MAX_FILE_SIZE = 50 * 1024 * 1024

# Storage path for voicebanks (same as other routers)
VOICEBANKS_BASE_PATH = Path("data/voicebanks")


# Dependency providers for batch oto generation


def get_voicebank_repository() -> VoicebankRepository:
    """Dependency provider for VoicebankRepository."""
    return VoicebankRepository(VOICEBANKS_BASE_PATH)


def get_oto_repository(
    voicebank_repo: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> OtoRepository:
    """Dependency provider for OtoRepository."""
    return OtoRepository(voicebank_repo)


def get_voicebank_service(
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> VoicebankService:
    """Dependency provider for VoicebankService."""
    return VoicebankService(repository)


def get_batch_oto_service(
    voicebank_service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    oto_repository: Annotated[OtoRepository, Depends(get_oto_repository)],
) -> BatchOtoService:
    """Dependency provider for BatchOtoService."""
    # Use SOFA-enabled suggester for batch processing (optimized for singing)
    oto_suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
    return BatchOtoService(voicebank_service, oto_suggester, oto_repository)


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
async def ml_status() -> dict[str, str | bool | list[str] | None]:
    """Check ML service status and model availability.

    Returns:
        Dictionary with status information including eSpeak and SOFA configuration
    """
    import torch

    from src.backend.utils.espeak_config import get_espeak_status

    espeak_status = get_espeak_status()

    # Check SOFA availability and languages
    sofa_available = is_sofa_available()
    sofa_languages: list[str] = []
    if sofa_available:
        sofa = get_sofa_aligner()
        sofa_languages = sofa.get_available_languages()

    return {
        "status": "available",
        "cuda_available": torch.cuda.is_available(),
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "model": "facebook/wav2vec2-lv-60-espeak-cv-ft",
        "espeak_configured": espeak_status.get("espeak_configured", False),
        "espeak_path": espeak_status.get("espeak_path"),
        "platform": espeak_status.get("platform"),
        "sofa_available": sofa_available,
        "sofa_languages": sofa_languages,
    }


@router.post("/oto/suggest", response_model=OtoSuggestion)
async def suggest_oto(
    voicebank_id: str = Query(..., description="ID of the voicebank"),
    filename: str = Query(..., description="Filename of the sample"),
    alias: str | None = Query(None, description="Optional alias override"),
    prefer_sofa: bool = Query(
        False,
        description="Use SOFA (Singing-Oriented Forced Aligner) if available",
    ),
    sofa_language: str = Query(
        "ja",
        description="Language code for SOFA alignment (ja, en, zh, ko, fr)",
    ),
) -> OtoSuggestion:
    """Get ML-suggested oto parameters for a voicebank sample.

    Analyzes the audio file using phoneme detection and suggests initial
    oto.ini parameters including offset, consonant, cutoff, preutterance,
    and overlap values.

    Args:
        voicebank_id: ID of the voicebank containing the sample
        filename: Filename of the sample within the voicebank
        alias: Optional alias override (auto-generated from filename if not provided)
        prefer_sofa: If True, use SOFA aligner (optimized for singing) when available
        sofa_language: Language code for SOFA alignment

    Returns:
        OtoSuggestion with suggested parameters and detected phonemes

    Raises:
        HTTPException: If file not found or processing fails
    """
    # TODO: Integrate with voicebank repository to resolve actual file path
    # For now, construct a reasonable path (this will need proper integration)
    # Typical voicebank structure: voicebanks/{id}/samples/{filename}
    voicebank_base = Path("voicebanks") / voicebank_id / "samples"
    audio_path = voicebank_base / filename

    if not audio_path.exists():
        # Try alternative paths
        alt_paths = [
            Path("voicebanks") / voicebank_id / filename,
            Path("data") / "voicebanks" / voicebank_id / filename,
        ]
        for alt_path in alt_paths:
            if alt_path.exists():
                audio_path = alt_path
                break
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sample file not found: {filename} in voicebank {voicebank_id}",
            )

    try:
        # Use SOFA-enabled suggester if preferred and available
        if prefer_sofa and is_sofa_available():
            suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
            suggestion = await suggester.suggest_oto(
                audio_path, alias, sofa_language=sofa_language
            )
        else:
            suggester = get_oto_suggester()
            suggestion = await suggester.suggest_oto(audio_path, alias)

        logger.info(
            f"Generated oto suggestion for {filename}: "
            f"offset={suggestion.offset}, preutterance={suggestion.preutterance}, "
            f"confidence={suggestion.confidence:.2f}"
        )

        return suggestion

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
        logger.exception("Unexpected error during oto suggestion")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        ) from e


@router.post("/oto/suggest-from-upload", response_model=OtoSuggestion)
async def suggest_oto_from_upload(
    file: UploadFile,
    alias: str | None = Query(None, description="Optional alias override"),
    prefer_sofa: bool = Query(
        False,
        description="Use SOFA (Singing-Oriented Forced Aligner) if available",
    ),
    sofa_language: str = Query(
        "ja",
        description="Language code for SOFA alignment (ja, en, zh, ko, fr)",
    ),
) -> OtoSuggestion:
    """Get ML-suggested oto parameters for an uploaded audio file.

    Analyzes the uploaded audio file using phoneme detection and suggests
    initial oto.ini parameters. Useful for testing or processing files
    not yet part of a voicebank.

    Args:
        file: Audio file (WAV, MP3, FLAC, OGG, or M4A)
        alias: Optional alias override (auto-generated from filename if not provided)
        prefer_sofa: If True, use SOFA aligner (optimized for singing) when available
        sofa_language: Language code for SOFA alignment

    Returns:
        OtoSuggestion with suggested parameters and detected phonemes

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

    # Preserve original filename for the suggestion
    original_filename = file.filename or "unknown.wav"
    ext = Path(original_filename).suffix.lower()

    try:
        # Save to temporary file for processing
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = Path(tmp_file.name)

        # Run oto suggestion
        # Use SOFA-enabled suggester if preferred and available
        if prefer_sofa and is_sofa_available():
            suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
            suggestion = await suggester.suggest_oto(
                tmp_path, alias, sofa_language=sofa_language
            )
        else:
            suggester = get_oto_suggester()
            suggestion = await suggester.suggest_oto(tmp_path, alias)

        # Replace the temp filename with the original
        suggestion = OtoSuggestion(
            filename=original_filename,
            alias=suggestion.alias,
            offset=suggestion.offset,
            consonant=suggestion.consonant,
            cutoff=suggestion.cutoff,
            preutterance=suggestion.preutterance,
            overlap=suggestion.overlap,
            confidence=suggestion.confidence,
            phonemes_detected=suggestion.phonemes_detected,
            audio_duration_ms=suggestion.audio_duration_ms,
        )

        logger.info(
            f"Generated oto suggestion from upload {original_filename}: "
            f"offset={suggestion.offset}, preutterance={suggestion.preutterance}, "
            f"confidence={suggestion.confidence:.2f}"
        )

        return suggestion

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
        logger.exception("Unexpected error during oto suggestion")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        ) from e

    finally:
        # Clean up temporary file
        if "tmp_path" in locals():
            with contextlib.suppress(OSError):
                tmp_path.unlink()


@router.post("/oto/batch-generate", response_model=BatchOtoResult)
async def batch_generate_oto(
    request: BatchOtoRequest,
    service: Annotated[BatchOtoService, Depends(get_batch_oto_service)],
) -> BatchOtoResult:
    """Generate oto entries for all samples in a voicebank.

    Processes each WAV sample through the ML pipeline to generate
    suggested oto parameters. This is a potentially long-running
    operation for large voicebanks.

    The operation continues even if individual samples fail processing.
    Failed samples are tracked in the response.

    Args:
        request: Batch generation request with voicebank_id and options

    Returns:
        BatchOtoResult with generated entries, statistics, and any failures

    Raises:
        HTTPException 404: If voicebank not found
        HTTPException 503: If ML model not available
    """
    try:
        result = await service.generate_oto_for_voicebank(
            voicebank_id=request.voicebank_id,
            overwrite_existing=request.overwrite_existing,
            sofa_language=request.sofa_language,
        )

        logger.info(
            f"Batch oto generation for voicebank '{request.voicebank_id}': "
            f"processed={result.processed}, skipped={result.skipped}, "
            f"failed={result.failed}, avg_confidence={result.average_confidence:.2f}"
        )

        return result

    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    except ModelNotLoadedError as e:
        logger.exception("Model not loaded")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ML model not available: {e}. Please try again later.",
        ) from e

    except Exception as e:
        logger.exception("Unexpected error during batch oto generation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        ) from e
