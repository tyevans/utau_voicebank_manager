"""API router for voicebank management."""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from src.backend.domain.voicebank import Voicebank, VoicebankSummary
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.voicebank_service import (
    VoicebankExistsError,
    VoicebankNotFoundError,
    VoicebankService,
    VoicebankValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voicebanks", tags=["voicebanks"])

# Storage path for voicebanks
VOICEBANKS_BASE_PATH = Path("data/voicebanks")

# Maximum file sizes
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB per file
MAX_ZIP_SIZE = 500 * 1024 * 1024  # 500MB for ZIP uploads


def get_voicebank_repository() -> VoicebankRepository:
    """Dependency provider for VoicebankRepository."""
    return VoicebankRepository(VOICEBANKS_BASE_PATH)


def get_voicebank_service(
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> VoicebankService:
    """Dependency provider for VoicebankService."""
    return VoicebankService(repository)


@router.get("", response_model=list[VoicebankSummary])
async def list_voicebanks(
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
) -> list[VoicebankSummary]:
    """List all voicebanks.

    Returns a lightweight summary of each voicebank including ID, name,
    sample count, and whether an oto.ini exists.

    Returns:
        List of voicebank summaries sorted by name
    """
    return await service.list_all()


@router.get("/{voicebank_id}", response_model=Voicebank)
async def get_voicebank(
    voicebank_id: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
) -> Voicebank:
    """Get detailed information about a voicebank.

    Args:
        voicebank_id: Slugified voicebank identifier

    Returns:
        Full voicebank details including path and creation time

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        return await service.get(voicebank_id)
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.post("", response_model=Voicebank, status_code=status.HTTP_201_CREATED)
async def create_voicebank(
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    name: Annotated[str, Form(description="Display name for the voicebank")],
    files: Annotated[
        list[UploadFile] | None,
        File(description="Individual WAV files and optional oto.ini"),
    ] = None,
    zip_file: Annotated[
        UploadFile | None,
        File(description="ZIP archive containing voicebank files"),
    ] = None,
) -> Voicebank:
    """Create a new voicebank by uploading files.

    Upload either individual files or a ZIP archive containing WAV samples
    and an optional oto.ini configuration.

    Args:
        name: Display name for the voicebank (will be slugified for ID)
        files: Individual WAV/ini files to upload
        zip_file: ZIP archive containing voicebank files

    Returns:
        Created voicebank details

    Raises:
        HTTPException 400: If validation fails (no WAV files, invalid ZIP, etc.)
        HTTPException 409: If voicebank with same ID already exists
        HTTPException 413: If upload exceeds size limits
    """
    try:
        # Handle ZIP upload
        if zip_file is not None and zip_file.filename:
            content = await zip_file.read()
            if len(content) > MAX_ZIP_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"ZIP file too large. Maximum size: {MAX_ZIP_SIZE // (1024*1024)}MB",
                )
            logger.info(f"Creating voicebank '{name}' from ZIP upload")
            return await service.create(name=name, zip_content=content)

        # Handle individual file uploads
        if files:
            file_dict: dict[str, bytes] = {}
            for upload_file in files:
                if upload_file.filename:
                    content = await upload_file.read()
                    if len(content) > MAX_FILE_SIZE:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"File '{upload_file.filename}' too large. Maximum: {MAX_FILE_SIZE // (1024*1024)}MB",
                        )
                    file_dict[upload_file.filename] = content

            logger.info(f"Creating voicebank '{name}' with {len(file_dict)} files")
            return await service.create(name=name, files=file_dict)

        # No files provided
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either files or zip_file must be provided",
        )

    except VoicebankValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except VoicebankExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e


@router.delete("/{voicebank_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voicebank(
    voicebank_id: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
) -> None:
    """Delete a voicebank and all its contents.

    This permanently removes the voicebank directory and all files within.

    Args:
        voicebank_id: Slugified voicebank identifier

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        await service.delete(voicebank_id)
        logger.info(f"Deleted voicebank '{voicebank_id}'")
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get("/{voicebank_id}/samples", response_model=list[str])
async def list_samples(
    voicebank_id: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
) -> list[str]:
    """List all WAV sample filenames in a voicebank.

    Args:
        voicebank_id: Slugified voicebank identifier

    Returns:
        List of WAV filenames sorted alphabetically

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        return await service.list_samples(voicebank_id)
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e


@router.get("/{voicebank_id}/samples/{filename}")
async def get_sample(
    voicebank_id: str,
    filename: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
) -> FileResponse:
    """Stream a WAV sample file.

    Returns the raw audio file with appropriate headers for playback
    or download.

    Args:
        voicebank_id: Slugified voicebank identifier
        filename: WAV filename (e.g., "_ka.wav")

    Returns:
        Audio file stream with audio/wav content type

    Raises:
        HTTPException 404: If voicebank or sample not found
    """
    try:
        sample_path = await service.get_sample_path(voicebank_id, filename)
        return FileResponse(
            path=sample_path,
            media_type="audio/wav",
            filename=filename,
        )
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
