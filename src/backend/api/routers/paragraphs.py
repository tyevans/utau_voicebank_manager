"""API router for paragraph prompt management.

Provides endpoints for accessing paragraph prompt libraries used in
efficient voicebank recording. Paragraph prompts contain natural sentences
that cover multiple phonemes, reducing recording time compared to
individual phoneme prompts.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.backend.domain.pagination import PaginatedResponse
from src.backend.domain.paragraph_prompt import ParagraphLibrary, ParagraphPrompt
from src.backend.services.paragraph_library_service import (
    ParagraphLibraryNotFoundError,
    ParagraphLibraryService,
    ParagraphLibrarySummary,
    get_paragraph_library_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/paragraphs", tags=["paragraphs"])


def get_library_service() -> ParagraphLibraryService:
    """Dependency provider for ParagraphLibraryService."""
    return get_paragraph_library_service()


@router.get("/libraries", response_model=PaginatedResponse[ParagraphLibrarySummary])
async def list_libraries(
    service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[ParagraphLibrarySummary]:
    """List all available paragraph libraries with pagination.

    Returns lightweight summaries of all registered paragraph libraries,
    including phoneme coverage statistics.

    Args:
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of library summaries sorted by name
    """
    all_items = service.list_libraries()
    total = len(all_items)
    items = all_items[offset : offset + limit]
    logger.debug(f"Listed {len(items)} of {total} paragraph libraries")
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/libraries/{library_id}", response_model=ParagraphLibrary)
async def get_library(
    library_id: str,
    service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
) -> ParagraphLibrary:
    """Get a paragraph library by ID.

    Returns the full library including all paragraph prompts and
    phoneme coverage metadata.

    Args:
        library_id: Library identifier (e.g., 'ja-cv-paragraphs-v1')

    Returns:
        Full paragraph library with all prompts

    Raises:
        HTTPException 404: If library not found
    """
    try:
        library = service.get_library(library_id)
        logger.debug(
            f"Retrieved library '{library_id}' with {library.total_paragraphs} paragraphs"
        )
        return library
    except ParagraphLibraryNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get("/{language}/{style}", response_model=PaginatedResponse[ParagraphPrompt])
async def get_paragraphs(
    language: str,
    style: str,
    service: Annotated[ParagraphLibraryService, Depends(get_library_service)],
    minimal: Annotated[
        bool,
        Query(
            description="If true, return only the minimal set of paragraphs "
            "needed for full phoneme coverage"
        ),
    ] = True,
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[ParagraphPrompt]:
    """Get paragraph prompts for a language and recording style with pagination.

    Returns paragraph prompts from the library matching the specified
    language and style combination. By default, returns the minimal set
    of paragraphs needed for complete phoneme coverage.

    Args:
        language: ISO 639-1 language code (e.g., 'ja' for Japanese)
        style: Recording style (e.g., 'cv', 'vcv', 'cvvc', 'vccv', 'arpasing')
        minimal: If true, return only minimal set for full coverage
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of paragraph prompts

    Raises:
        HTTPException 404: If no library found for language/style combination
    """
    try:
        all_items = service.get_paragraphs(language, style, minimal=minimal)
        total = len(all_items)
        items = all_items[offset : offset + limit]
        logger.debug(
            f"Retrieved {len(items)} of {total} paragraphs for {language}/{style} "
            f"(minimal={minimal})"
        )
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)
    except ParagraphLibraryNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
