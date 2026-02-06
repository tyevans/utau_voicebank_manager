"""Centralized exception handlers for the FastAPI application.

Maps domain exceptions raised by services to appropriate HTTP responses.
Routers that already handle exceptions inline will continue to work
(HTTPException re-raises take priority over app-level handlers). New
routers can simply let domain exceptions propagate and rely on these
handlers to produce the correct HTTP status codes.

Usage in main.py:
    from src.backend.api.exception_handlers import register_exception_handlers
    register_exception_handlers(app)
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.backend.ml.phoneme_detector import (
    AudioProcessingError,
    ModelNotLoadedError,
)
from src.backend.services.job_service import JobNotFoundError
from src.backend.services.oto_service import (
    OtoEntryExistsError,
    OtoNotFoundError,
    OtoValidationError,
)
from src.backend.services.paragraph_library_service import (
    ParagraphLibraryNotFoundError,
)
from src.backend.services.paragraph_segmentation_service import SegmentationError
from src.backend.services.reclist_service import ReclistValidationError
from src.backend.services.recording_session_service import (
    SessionNotFoundError,
    SessionStateError,
    SessionValidationError,
    VoicebankNotGeneratedError,
)
from src.backend.services.voicebank_service import (
    VoicebankExistsError,
    VoicebankNotFoundError,
    VoicebankValidationError,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mapping: exception class -> HTTP status code
#
# "Not found" errors  -> 404
# "Validation" errors  -> 400
# "Already exists"     -> 409
# "State conflict"     -> 409
# "Model unavailable"  -> 503
# "Unprocessable"      -> 422
# ---------------------------------------------------------------------------

_NOT_FOUND_EXCEPTIONS: list[type[Exception]] = [
    VoicebankNotFoundError,
    OtoNotFoundError,
    SessionNotFoundError,
    JobNotFoundError,
    ParagraphLibraryNotFoundError,
    VoicebankNotGeneratedError,
]

_BAD_REQUEST_EXCEPTIONS: list[type[Exception]] = [
    VoicebankValidationError,
    OtoValidationError,
    SessionValidationError,
    SegmentationError,
    ReclistValidationError,
]

_CONFLICT_EXCEPTIONS: list[type[Exception]] = [
    VoicebankExistsError,
    OtoEntryExistsError,
    SessionStateError,
]


# ---------------------------------------------------------------------------
# Handler factories
# ---------------------------------------------------------------------------


def _make_handler(status_code: int):
    """Create an exception handler that returns a JSON error response.

    Args:
        status_code: HTTP status code to return.

    Returns:
        An async exception handler compatible with FastAPI.
    """

    async def handler(_request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={"detail": str(exc)},
        )

    return handler


async def _model_not_loaded_handler(
    _request: Request, exc: ModelNotLoadedError
) -> JSONResponse:
    """Handle ML model unavailability.

    Returns 503 Service Unavailable so clients know to retry later.
    """
    logger.error("ML model not available: %s", exc)
    return JSONResponse(
        status_code=503,
        content={"detail": f"ML model not available: {exc}. Please try again later."},
    )


async def _audio_processing_handler(
    _request: Request, exc: AudioProcessingError
) -> JSONResponse:
    """Handle audio processing failures.

    Returns 422 Unprocessable Entity -- the audio file was received but
    could not be processed.
    """
    logger.error("Audio processing failed: %s", exc)
    return JSONResponse(
        status_code=422,
        content={"detail": f"Failed to process audio file: {exc}"},
    )


async def _unhandled_exception_handler(
    request: Request, _exc: Exception
) -> JSONResponse:
    """Catch-all handler for unexpected exceptions.

    Logs the full traceback server-side but returns only a generic
    message to the client -- never expose internal error details.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred."},
    )


# ---------------------------------------------------------------------------
# Public registration function
# ---------------------------------------------------------------------------


def register_exception_handlers(app: FastAPI) -> None:
    """Register all centralized exception handlers on the FastAPI app.

    Call this once during application startup (after creating the app
    instance, before including routers).

    Args:
        app: The FastAPI application instance.
    """
    # 404 Not Found
    not_found_handler = _make_handler(404)
    for exc_class in _NOT_FOUND_EXCEPTIONS:
        app.add_exception_handler(exc_class, not_found_handler)

    # 400 Bad Request
    bad_request_handler = _make_handler(400)
    for exc_class in _BAD_REQUEST_EXCEPTIONS:
        app.add_exception_handler(exc_class, bad_request_handler)

    # 409 Conflict
    conflict_handler = _make_handler(409)
    for exc_class in _CONFLICT_EXCEPTIONS:
        app.add_exception_handler(exc_class, conflict_handler)

    # ML-specific handlers
    app.add_exception_handler(ModelNotLoadedError, _model_not_loaded_handler)
    app.add_exception_handler(AudioProcessingError, _audio_processing_handler)

    # Catch-all for unhandled exceptions (must be registered last)
    app.add_exception_handler(Exception, _unhandled_exception_handler)

    logger.info("Registered centralized exception handlers")
