"""API router for custom recording list import and preview.

Provides a parse-and-preview endpoint for importing custom recording
lists from text files. Supports plain text (one alias per line) and
OREMO-style (tab-separated) formats commonly used across UTAU language
communities.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from src.backend.domain.recording_list import ReclistParseRequest, RecordingList
from src.backend.services.reclist_service import ReclistService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reclists", tags=["reclists"])


def get_reclist_service() -> ReclistService:
    """Dependency provider for ReclistService."""
    return ReclistService()


@router.post("/parse", response_model=RecordingList)
async def parse_reclist(
    file: Annotated[UploadFile, File(description="Recording list text file to parse")],
    name: Annotated[
        str,
        Form(description="Name for this recording list", min_length=1, max_length=100),
    ],
    service: Annotated[ReclistService, Depends(get_reclist_service)],
    language: Annotated[
        str, Form(description="ISO 639-1 language code or 'other'")
    ] = "other",
    style: Annotated[
        str,
        Form(description="Recording style (cv, vcv, cvvc, vccv, arpasing, or custom)"),
    ] = "custom",
) -> RecordingList:
    """Parse a custom recording list file and return a structured preview.

    Accepts a text file upload containing recording prompts in either
    plain text format (one alias per line) or OREMO-style format
    (tab-separated filename and alias). The format is auto-detected.

    Comment lines starting with ``#`` or ``;`` are treated as category
    headers for the entries that follow them.

    This endpoint does NOT save anything -- it parses the file and returns
    the result for the frontend to preview. The parsed prompts can then be
    used when creating a recording session.

    **Plain text example:**
    ```
    # k-row
    ka
    ki
    ku
    ke
    ko
    ```

    **OREMO-style example:**
    ```
    _ka\tka
    _ki\tki
    _aku\ta ku
    ```

    Args:
        file: Text file to parse (max 1 MB).
        name: Human-readable name for the recording list.
        language: ISO 639-1 language code (default: "other").
        style: Recording style hint (default: "custom").

    Returns:
        Parsed RecordingList with entries, detected format, and any warnings.

    Raises:
        HTTPException 400: If the file is empty, too large, or unparseable.
    """
    file_data = await file.read()

    request = ReclistParseRequest(
        name=name,
        language=language,
        style=style,
    )

    result = await service.parse_upload(file_data, request)

    logger.info(
        "Successfully parsed recording list '%s': %d entries (%s format)",
        name,
        result.total_entries,
        result.format_detected,
    )

    return result
