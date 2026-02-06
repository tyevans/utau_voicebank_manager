"""API router for ML-powered phoneme detection and oto suggestions."""

import contextlib
import logging
import tempfile
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from src.backend.api.dependencies import (
    get_oto_repository,
    get_voicebank_service,
    get_voicebanks_path,
)
from src.backend.domain.alignment_config import AlignmentConfig
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
from src.backend.services.alignment_config_store import (
    load_alignment_config,
    save_alignment_config,
)
from src.backend.services.batch_oto_service import BatchOtoService
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)
from src.backend.utils.path_validation import validate_path_component

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml", tags=["ml"])

# Allowed audio file extensions
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


# -----------------------------------------------------------------------------
# Alignment Config Request/Response Models
# -----------------------------------------------------------------------------


class AlignmentConfigResponse(BaseModel):
    """Response model for alignment configuration."""

    tightness: float = Field(
        ge=0.0,
        le=1.0,
        description="Alignment tightness (0.0 = loose, 1.0 = tight)",
    )
    method_override: Literal["sofa", "fa"] | None = Field(
        default=None,
        description="Manual override for alignment method, or None for auto-select",
    )
    computed_params: dict[str, float] = Field(
        description="Computed alignment parameters for UI display"
    )


class AlignmentPreviewRequest(BaseModel):
    """Request model for previewing alignment parameters."""

    tightness: float = Field(
        ge=0.0,
        le=1.0,
        default=0.5,
        description="Tightness value to preview",
    )
    recording_style: Literal["cv", "vcv", "cvvc"] | None = Field(
        default=None,
        description="Optional recording style for style-specific adjustments",
    )


class AlignmentPreviewResponse(BaseModel):
    """Response showing computed params for a tightness value."""

    tightness: float = Field(description="The tightness value used for preview")
    recording_style: str | None = Field(description="Recording style applied, if any")
    params: dict[str, float] = Field(description="Computed alignment parameters")


class AlignmentMethodInfo(BaseModel):
    """Information about an alignment method."""

    name: str = Field(description="Method identifier")
    display_name: str = Field(description="Human-readable name")
    available: bool = Field(description="Whether this method is currently available")
    description: str = Field(description="Brief description of the method")
    languages: list[str] = Field(
        default_factory=list,
        description="Supported languages (if applicable)",
    )


class AlignmentMethodsResponse(BaseModel):
    """Response listing available alignment methods."""

    methods: list[AlignmentMethodInfo] = Field(
        description="List of all alignment methods and their availability"
    )
    recommended: str = Field(description="Recommended method for best results")


# Maximum file size (50MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


# Dependency provider for batch oto generation (ML-specific)


def get_batch_oto_service(
    voicebank_service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    oto_repository: Annotated[OtoRepository, Depends(get_oto_repository)],
) -> BatchOtoService:
    """Dependency provider for BatchOtoService.

    Reads alignment config from disk so all workers share the same state.
    """
    alignment_config = load_alignment_config()

    # Determine alignment method from config
    if alignment_config.method_override == "fa":
        use_forced_alignment = True
        use_sofa = False
    elif alignment_config.method_override == "sofa":
        use_forced_alignment = True
        use_sofa = True
    else:
        # Auto-select: prefer SOFA if available, always use MMS_FA as fallback
        use_forced_alignment = True
        use_sofa = is_sofa_available()

    oto_suggester = OtoSuggester(
        use_forced_alignment=use_forced_alignment, use_sofa=use_sofa
    )
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
    voicebanks_path: Annotated[Path, Depends(get_voicebanks_path)],
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
    tightness: float | None = Query(
        None,
        ge=0.0,
        le=1.0,
        description="Alignment tightness (0.0=loose, 1.0=tight). If not provided, uses global config.",
    ),
    method_override: str | None = Query(
        None,
        description="Override alignment method: 'sofa' or 'fa'. If not provided, uses global config.",
    ),
) -> OtoSuggestion:
    """Get ML-suggested oto parameters for a voicebank sample.

    Analyzes the audio file using phoneme detection and suggests initial
    oto.ini parameters including offset, consonant, cutoff, preutterance,
    and overlap values.

    Args:
        voicebanks_path: Injected base path for voicebank storage
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
    validate_path_component(voicebank_id, label="voicebank_id")
    validate_path_component(filename, label="filename")

    # Resolve audio file path using the injected voicebanks base path
    audio_path = voicebanks_path / voicebank_id / filename

    if not audio_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample file not found: {filename} in voicebank {voicebank_id}",
        )

    try:
        # Determine which method to use:
        # 1. Explicit method_override param takes precedence
        # 2. Then persisted alignment config method_override
        # 3. Then prefer_sofa param (legacy)
        # 4. Then auto-detect
        alignment_config = load_alignment_config()
        effective_method = method_override or alignment_config.method_override
        if effective_method == "sofa" and is_sofa_available():
            suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
            suggestion = await suggester.suggest_oto(
                audio_path, alias, sofa_language=sofa_language
            )
        elif effective_method == "fa":
            suggester = OtoSuggester(use_forced_alignment=True, use_sofa=False)
            suggestion = await suggester.suggest_oto(audio_path, alias)
        elif prefer_sofa and is_sofa_available():
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
            method_used=suggestion.method_used,
            fallback_reasons=suggestion.fallback_reasons,
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
    voicebanks_path: Annotated[Path, Depends(get_voicebanks_path)],
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
        # If request includes alignment overrides, create a custom service
        if request.tightness is not None or request.method_override is not None:
            alignment_config = load_alignment_config()
            effective_method = (
                request.method_override or alignment_config.method_override
            )
            if effective_method == "fa":
                use_forced_alignment = True
                use_sofa = False
            elif effective_method == "sofa":
                use_forced_alignment = True
                use_sofa = True
            else:
                use_forced_alignment = True
                use_sofa = is_sofa_available()

            custom_suggester = OtoSuggester(
                use_forced_alignment=use_forced_alignment, use_sofa=use_sofa
            )
            # Create a new service with the custom suggester
            voicebank_repo = VoicebankRepository(voicebanks_path)
            oto_repo = OtoRepository(voicebank_repo)
            vb_service = VoicebankService(voicebank_repo)
            custom_service = BatchOtoService(vb_service, custom_suggester, oto_repo)

            result = await custom_service.generate_oto_for_voicebank(
                voicebank_id=request.voicebank_id,
                overwrite_existing=request.overwrite_existing,
                sofa_language=request.sofa_language,
            )
        else:
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


# -----------------------------------------------------------------------------
# Alignment Config Endpoints
# -----------------------------------------------------------------------------


def _params_to_dict(params) -> dict[str, float]:
    """Convert AlignmentParams to a dictionary."""
    return {
        "offset_padding_ms": params.offset_padding_ms,
        "cutoff_padding_ms": params.cutoff_padding_ms,
        "overlap_ratio": params.overlap_ratio,
        "energy_threshold_ratio": params.energy_threshold_ratio,
        "consonant_vowel_extension_ratio": params.consonant_vowel_extension_ratio,
        "min_confidence_threshold": params.min_confidence_threshold,
    }


@router.get("/alignment/config", response_model=AlignmentConfigResponse)
async def get_alignment_config() -> AlignmentConfigResponse:
    """Get the current default alignment configuration.

    Returns the current tightness setting, any method override, and the
    computed alignment parameters for UI display.

    Returns:
        AlignmentConfigResponse with current config and computed params
    """
    config = load_alignment_config()
    params = config.get_params()
    return AlignmentConfigResponse(
        tightness=config.tightness,
        method_override=config.method_override,
        computed_params=_params_to_dict(params),
    )


@router.post("/alignment/config", response_model=AlignmentConfigResponse)
async def update_alignment_config(config: AlignmentConfig) -> AlignmentConfigResponse:
    """Update the default alignment configuration.

    Persists the alignment tightness and optional method override to disk
    so that all workers share the same configuration state.

    Args:
        config: New alignment configuration with tightness and optional method override

    Returns:
        AlignmentConfigResponse with updated config and computed params
    """
    save_alignment_config(config)

    logger.info(
        f"Updated alignment config: tightness={config.tightness}, "
        f"method_override={config.method_override}"
    )

    params = config.get_params()
    return AlignmentConfigResponse(
        tightness=config.tightness,
        method_override=config.method_override,
        computed_params=_params_to_dict(params),
    )


@router.post("/alignment/config/preview", response_model=AlignmentPreviewResponse)
async def preview_alignment_config(
    request: AlignmentPreviewRequest,
) -> AlignmentPreviewResponse:
    """Preview alignment parameters for a given tightness and style.

    Computes what parameters would be used for a given tightness value
    without changing the current default configuration. Useful for UI
    sliders to show real-time parameter updates.

    Args:
        request: Preview request with tightness and optional recording style

    Returns:
        AlignmentPreviewResponse with computed params for the given settings
    """
    preview_config = AlignmentConfig(tightness=request.tightness)
    params = preview_config.get_params(recording_style=request.recording_style)

    return AlignmentPreviewResponse(
        tightness=request.tightness,
        recording_style=request.recording_style,
        params=_params_to_dict(params),
    )


@router.get("/alignment/methods", response_model=AlignmentMethodsResponse)
async def get_alignment_methods() -> AlignmentMethodsResponse:
    """Get available alignment methods and their status.

    Returns a list of all supported alignment methods, whether they are
    currently available (installed and configured), and which is recommended.

    Returns:
        AlignmentMethodsResponse with method availability and recommendation
    """
    # Check SOFA availability and languages
    sofa_available = is_sofa_available()
    sofa_languages: list[str] = []
    if sofa_available:
        sofa = get_sofa_aligner()
        sofa_languages = sofa.get_available_languages()

    # MMS_FA is always available (TorchAudio bundled model)
    mms_fa_available = True
    try:
        import torchaudio  # noqa: F401
    except ImportError:
        mms_fa_available = False

    methods = [
        AlignmentMethodInfo(
            name="sofa",
            display_name="SOFA Neural Aligner",
            available=sofa_available,
            description=(
                "Singing-Oriented Forced Aligner using neural networks. "
                "Best accuracy for singing voice recordings."
            ),
            languages=sofa_languages,
        ),
        AlignmentMethodInfo(
            name="fa",
            display_name="MMS Forced Alignment",
            available=mms_fa_available,
            description=(
                "TorchAudio MMS_FA forced alignment model. "
                "Supports 1100+ languages with good accuracy for speech and singing."
            ),
            languages=[],  # MMS_FA supports 1100+ languages, too many to list
        ),
    ]

    # Determine recommended method
    recommended = "sofa" if sofa_available else "fa"

    return AlignmentMethodsResponse(
        methods=methods,
        recommended=recommended,
    )
