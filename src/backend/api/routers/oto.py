"""API router for oto.ini entry management."""

import logging
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.pagination import PaginatedResponse
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.oto_service import (
    OtoEntryExistsError,
    OtoNotFoundError,
    OtoService,
    OtoValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voicebanks", tags=["oto"])

# Storage path for voicebanks (same as voicebanks router)
VOICEBANKS_BASE_PATH = Path("data/voicebanks")


# Request/Response models


class OtoEntryCreate(BaseModel):
    """Request model for creating a new oto entry."""

    filename: str = Field(
        description="WAV filename (e.g., '_ka.wav')",
        min_length=1,
    )
    alias: str = Field(
        description="Phoneme alias (e.g., '- ka' for CV, 'a ka' for VCV)",
    )
    offset: float = Field(
        default=0,
        ge=0,
        description="Playback start position in milliseconds",
    )
    consonant: float = Field(
        default=0,
        ge=0,
        description="Fixed region end in milliseconds",
    )
    cutoff: float = Field(
        default=0,
        description="Playback end position in ms (negative = from audio end)",
    )
    preutterance: float = Field(
        default=0,
        ge=0,
        description="How early to start before the note begins (ms)",
    )
    overlap: float = Field(
        default=0,
        ge=0,
        description="Crossfade duration with previous note (ms)",
    )

    def to_oto_entry(self) -> OtoEntry:
        """Convert to OtoEntry model."""
        return OtoEntry(
            filename=self.filename,
            alias=self.alias,
            offset=self.offset,
            consonant=self.consonant,
            cutoff=self.cutoff,
            preutterance=self.preutterance,
            overlap=self.overlap,
        )


class OtoEntryUpdate(BaseModel):
    """Request model for updating an oto entry.

    All fields are optional - only provided fields will be updated.
    """

    offset: float | None = Field(
        default=None,
        ge=0,
        description="Playback start position in milliseconds",
    )
    consonant: float | None = Field(
        default=None,
        ge=0,
        description="Fixed region end in milliseconds",
    )
    cutoff: float | None = Field(
        default=None,
        description="Playback end position in ms (negative = from audio end)",
    )
    preutterance: float | None = Field(
        default=None,
        ge=0,
        description="How early to start before the note begins (ms)",
    )
    overlap: float | None = Field(
        default=None,
        ge=0,
        description="Crossfade duration with previous note (ms)",
    )


class OtoEntryResponse(BaseModel):
    """Response model for an oto entry."""

    filename: str = Field(description="WAV filename")
    alias: str = Field(description="Phoneme alias")
    offset: float = Field(description="Playback start position (ms)")
    consonant: float = Field(description="Fixed region end (ms)")
    cutoff: float = Field(description="Playback end position (ms)")
    preutterance: float = Field(description="Pre-utterance time (ms)")
    overlap: float = Field(description="Crossfade duration (ms)")

    @classmethod
    def from_entry(cls, entry: OtoEntry) -> "OtoEntryResponse":
        """Create response from OtoEntry model."""
        return cls(
            filename=entry.filename,
            alias=entry.alias,
            offset=entry.offset,
            consonant=entry.consonant,
            cutoff=entry.cutoff,
            preutterance=entry.preutterance,
            overlap=entry.overlap,
        )


# Dependency injection


def get_voicebank_repository() -> VoicebankRepository:
    """Dependency provider for VoicebankRepository."""
    return VoicebankRepository(VOICEBANKS_BASE_PATH)


def get_oto_repository(
    voicebank_repo: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> OtoRepository:
    """Dependency provider for OtoRepository."""
    return OtoRepository(voicebank_repo)


def get_oto_service(
    repository: Annotated[OtoRepository, Depends(get_oto_repository)],
) -> OtoService:
    """Dependency provider for OtoService."""
    return OtoService(repository)


# Route handlers


@router.get("/{voicebank_id}/oto", response_model=PaginatedResponse[OtoEntryResponse])
async def get_oto_entries(
    voicebank_id: str,
    service: Annotated[OtoService, Depends(get_oto_service)],
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[OtoEntryResponse]:
    """Get oto entries for a voicebank with pagination.

    Returns entries defined in the voicebank's oto.ini file.
    Returns empty list if oto.ini doesn't exist yet.

    Args:
        voicebank_id: Voicebank identifier
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of oto entries

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        entries = await service.get_entries(voicebank_id)
        all_items = [OtoEntryResponse.from_entry(e) for e in entries]
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)
    except OtoNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get(
    "/{voicebank_id}/oto/{filename}",
    response_model=PaginatedResponse[OtoEntryResponse],
)
async def get_oto_entries_for_file(
    voicebank_id: str,
    filename: str,
    service: Annotated[OtoService, Depends(get_oto_service)],
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[OtoEntryResponse]:
    """Get oto entries for a specific WAV file with pagination.

    A single WAV file can have multiple oto entries with different aliases
    (e.g., for VCV voicebanks where one file contains multiple phonemes).

    Args:
        voicebank_id: Voicebank identifier
        filename: WAV filename (URL-encoded)
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of oto entries for the file

    Raises:
        HTTPException 404: If voicebank not found
    """
    # URL decode the filename
    decoded_filename = unquote(filename)

    try:
        entries = await service.get_entries_for_file(voicebank_id, decoded_filename)
        all_items = [OtoEntryResponse.from_entry(e) for e in entries]
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)
    except OtoNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post(
    "/{voicebank_id}/oto",
    response_model=OtoEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_oto_entry(
    voicebank_id: str,
    entry: OtoEntryCreate,
    service: Annotated[OtoService, Depends(get_oto_service)],
) -> OtoEntryResponse:
    """Create a new oto entry.

    Validates that the referenced WAV file exists and that no duplicate
    entry exists for the same filename+alias combination.

    If oto.ini doesn't exist, it will be created.

    Args:
        voicebank_id: Voicebank identifier
        entry: Oto entry data

    Returns:
        Created oto entry

    Raises:
        HTTPException 400: If WAV file doesn't exist
        HTTPException 404: If voicebank not found
        HTTPException 409: If entry with same filename+alias already exists
    """
    try:
        created = await service.create_entry(voicebank_id, entry.to_oto_entry())
        logger.info(
            f"Created oto entry: {created.filename}={created.alias} "
            f"in voicebank '{voicebank_id}'"
        )
        return OtoEntryResponse.from_entry(created)
    except OtoNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except OtoValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except OtoEntryExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e


@router.put(
    "/{voicebank_id}/oto/{filename}/{alias}",
    response_model=OtoEntryResponse,
)
async def update_oto_entry(
    voicebank_id: str,
    filename: str,
    alias: str,
    update: OtoEntryUpdate,
    service: Annotated[OtoService, Depends(get_oto_service)],
) -> OtoEntryResponse:
    """Update an existing oto entry.

    Only provided fields will be updated; omitted fields retain their
    existing values.

    Args:
        voicebank_id: Voicebank identifier
        filename: WAV filename (URL-encoded)
        alias: Entry alias (URL-encoded, use %20 for spaces)
        update: Fields to update

    Returns:
        Updated oto entry

    Raises:
        HTTPException 404: If voicebank or entry not found
    """
    # URL decode path parameters
    decoded_filename = unquote(filename)
    decoded_alias = unquote(alias)

    try:
        updated = await service.update_entry(
            voicebank_id=voicebank_id,
            filename=decoded_filename,
            alias=decoded_alias,
            offset=update.offset,
            consonant=update.consonant,
            cutoff=update.cutoff,
            preutterance=update.preutterance,
            overlap=update.overlap,
        )
        logger.info(
            f"Updated oto entry: {decoded_filename}={decoded_alias} "
            f"in voicebank '{voicebank_id}'"
        )
        return OtoEntryResponse.from_entry(updated)
    except OtoNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.delete(
    "/{voicebank_id}/oto/{filename}/{alias}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_oto_entry(
    voicebank_id: str,
    filename: str,
    alias: str,
    service: Annotated[OtoService, Depends(get_oto_service)],
) -> None:
    """Delete an oto entry.

    Removes the specified entry from the voicebank's oto.ini file.

    Args:
        voicebank_id: Voicebank identifier
        filename: WAV filename (URL-encoded)
        alias: Entry alias (URL-encoded, use %20 for spaces)

    Raises:
        HTTPException 404: If voicebank or entry not found
    """
    # URL decode path parameters
    decoded_filename = unquote(filename)
    decoded_alias = unquote(alias)

    try:
        await service.delete_entry(voicebank_id, decoded_filename, decoded_alias)
        logger.info(
            f"Deleted oto entry: {decoded_filename}={decoded_alias} "
            f"in voicebank '{voicebank_id}'"
        )
    except OtoNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
