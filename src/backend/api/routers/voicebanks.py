"""API router for voicebank management."""

import io
import logging
from enum import Enum
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from src.backend.api.dependencies import (
    get_voicebank_repository,
    get_voicebank_service,
)
from src.backend.domain.pagination import PaginatedResponse
from src.backend.domain.voicebank import Voicebank, VoicebankSummary
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.voicebank_service import (
    VoicebankExistsError,
    VoicebankNotFoundError,
    VoicebankService,
    VoicebankValidationError,
)
from src.backend.utils.path_validation import validate_path_component

logger = logging.getLogger(__name__)


class MetadataFilename(str, Enum):
    """Allowed metadata filenames for voicebanks."""

    character = "character.txt"
    readme = "readme.txt"


class MetadataContentResponse(BaseModel):
    """Response containing metadata file content."""

    content: str = Field(description="Text content of the metadata file")


class MetadataContentRequest(BaseModel):
    """Request body for updating metadata file content."""

    content: str = Field(description="Text content to write to the metadata file")


class MetadataSuccessResponse(BaseModel):
    """Response confirming a successful metadata write."""

    success: bool = Field(description="Whether the write was successful")


class IconSuccessResponse(BaseModel):
    """Response confirming a successful icon operation."""

    success: bool = Field(description="Whether the operation was successful")


router = APIRouter(prefix="/voicebanks", tags=["voicebanks"])

# Maximum file sizes
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB per file
MAX_ZIP_SIZE = 500 * 1024 * 1024  # 500MB for ZIP uploads
MAX_ICON_SIZE = 5 * 1024 * 1024  # 5MB for icon uploads

# Icon settings
ICON_SIZE = (100, 100)  # UTAU standard icon dimensions
ICON_ACCEPTED_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-ms-bmp",
}

# Accepted MIME types for WAV uploads
WAV_ACCEPTED_TYPES = {"audio/wav", "audio/x-wav", "audio/wave"}

# Accepted MIME types for ZIP uploads
ZIP_ACCEPTED_TYPES = {"application/zip", "application/x-zip-compressed"}

# WAV magic bytes: files must start with "RIFF"
WAV_MAGIC_BYTES = b"RIFF"

# Maximum total decompressed size for ZIP uploads (500MB)
MAX_ZIP_DECOMPRESSED_SIZE = 500 * 1024 * 1024


@router.get("", response_model=PaginatedResponse[VoicebankSummary])
async def list_voicebanks(
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[VoicebankSummary]:
    """List all voicebanks with pagination.

    Returns a lightweight summary of each voicebank including ID, name,
    sample count, and whether an oto.ini exists.

    Args:
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of voicebank summaries sorted by name
    """
    all_items = await service.list_all()
    total = len(all_items)
    items = all_items[offset : offset + limit]
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


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
            # Validate ZIP content type
            if (
                not zip_file.content_type
                or zip_file.content_type not in ZIP_ACCEPTED_TYPES
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid file type '{zip_file.content_type}'. "
                    "Expected a ZIP archive (application/zip)",
                )

            content = await zip_file.read()
            if len(content) > MAX_ZIP_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"ZIP file too large. Maximum size: {MAX_ZIP_SIZE // (1024*1024)}MB",
                )
            logger.info(f"Creating voicebank '{name}' from ZIP upload")
            return await service.create(
                name=name,
                zip_content=content,
                max_decompressed_size=MAX_ZIP_DECOMPRESSED_SIZE,
            )

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

                    # Validate WAV files: MIME type and magic bytes
                    if upload_file.filename.lower().endswith(".wav"):
                        if (
                            upload_file.content_type
                            and upload_file.content_type not in WAV_ACCEPTED_TYPES
                        ):
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"File '{upload_file.filename}' has invalid content type "
                                f"'{upload_file.content_type}'. Expected audio/wav",
                            )
                        if not content[:4] == WAV_MAGIC_BYTES:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"File '{upload_file.filename}' is not a valid WAV file "
                                "(missing RIFF header)",
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


@router.get("/{voicebank_id}/samples", response_model=PaginatedResponse[str])
async def list_samples(
    voicebank_id: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    limit: Annotated[
        int,
        Query(ge=1, le=500, description="Maximum items to return"),
    ] = 100,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of items to skip"),
    ] = 0,
) -> PaginatedResponse[str]:
    """List WAV sample filenames in a voicebank with pagination.

    Args:
        voicebank_id: Slugified voicebank identifier
        limit: Maximum number of items to return (1-500, default 100)
        offset: Number of items to skip (default 0)

    Returns:
        Paginated list of WAV filenames sorted alphabetically

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        all_items = await service.list_samples(voicebank_id)
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)
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
    validate_path_component(voicebank_id, label="voicebank_id")
    validate_path_component(filename, label="filename")

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


@router.get(
    "/{voicebank_id}/metadata/{filename}",
    response_model=MetadataContentResponse,
)
async def get_metadata_file(
    voicebank_id: str,
    filename: MetadataFilename,
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> MetadataContentResponse:
    """Read a metadata file (character.txt or readme.txt) from a voicebank.

    Returns the file content as a string. If the voicebank exists but the
    file has not been created yet, returns an empty string.

    Args:
        voicebank_id: Slugified voicebank identifier
        filename: Metadata filename ("character.txt" or "readme.txt")

    Returns:
        Metadata file content

    Raises:
        HTTPException 404: If voicebank not found
    """
    content = await repository.get_metadata_file(voicebank_id, filename.value)
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voicebank '{voicebank_id}' not found",
        )
    return MetadataContentResponse(content=content)


@router.put(
    "/{voicebank_id}/metadata/{filename}",
    response_model=MetadataSuccessResponse,
)
async def update_metadata_file(
    voicebank_id: str,
    filename: MetadataFilename,
    body: MetadataContentRequest,
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> MetadataSuccessResponse:
    """Write a metadata file (character.txt or readme.txt) to a voicebank.

    Creates or overwrites the specified metadata file in the voicebank
    directory.

    Args:
        voicebank_id: Slugified voicebank identifier
        filename: Metadata filename ("character.txt" or "readme.txt")
        body: Request body containing the file content to write

    Returns:
        Success confirmation

    Raises:
        HTTPException 404: If voicebank not found
    """
    saved = await repository.save_metadata_file(
        voicebank_id, filename.value, body.content
    )
    if not saved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voicebank '{voicebank_id}' not found",
        )
    logger.info(
        f"Updated metadata file '{filename.value}' for voicebank '{voicebank_id}'"
    )
    return MetadataSuccessResponse(success=True)


# Icon management endpoints


def _convert_to_bmp_icon(image_data: bytes) -> bytes:
    """Convert any supported image to a 100x100 BMP icon.

    Accepts PNG, JPEG, or BMP input and produces an RGB BMP suitable
    for use as a UTAU voicebank icon.

    Args:
        image_data: Raw image file bytes

    Returns:
        BMP-encoded image bytes at 100x100 pixels

    Raises:
        ValueError: If the data is not a valid image
    """
    try:
        img = Image.open(io.BytesIO(image_data))
    except Exception as e:
        raise ValueError("File is not a valid image") from e

    img = img.convert("RGB")  # BMP does not support alpha channel
    img = img.resize(ICON_SIZE, Image.Resampling.LANCZOS)

    output = io.BytesIO()
    img.save(output, format="BMP")
    return output.getvalue()


@router.post(
    "/{voicebank_id}/icon",
    response_model=IconSuccessResponse,
)
async def upload_icon(
    voicebank_id: str,
    file: Annotated[UploadFile, File(description="Image file (PNG, JPEG, or BMP)")],
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> IconSuccessResponse:
    """Upload or replace the voicebank icon.

    Accepts PNG, JPEG, or BMP images. The image is converted to BMP format
    and resized to 100x100 pixels, matching the UTAU standard icon format.

    Args:
        voicebank_id: Slugified voicebank identifier
        file: Image file upload

    Returns:
        Success confirmation

    Raises:
        HTTPException 400: If the file is not a valid image
        HTTPException 404: If voicebank not found
        HTTPException 413: If file exceeds 5MB size limit
    """
    # Validate content type (reject None and unsupported types)
    if not file.content_type or file.content_type not in ICON_ACCEPTED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{file.content_type}'. "
            "Accepted: PNG, JPEG, GIF, WebP, BMP",
        )

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_ICON_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Icon file too large. Maximum size: {MAX_ICON_SIZE // (1024 * 1024)}MB",
        )

    # Convert to BMP icon
    try:
        bmp_data = _convert_to_bmp_icon(content)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    # Save to voicebank directory
    saved = await repository.save_icon(voicebank_id, bmp_data)
    if not saved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voicebank '{voicebank_id}' not found",
        )

    logger.info(f"Uploaded icon for voicebank '{voicebank_id}'")
    return IconSuccessResponse(success=True)


@router.get("/{voicebank_id}/icon")
async def get_icon(
    voicebank_id: str,
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> FileResponse:
    """Get the voicebank icon.

    Returns the icon.bmp file for the specified voicebank.

    Args:
        voicebank_id: Slugified voicebank identifier

    Returns:
        BMP image file

    Raises:
        HTTPException 404: If voicebank or icon not found
    """
    icon_path = await repository.get_icon_path(voicebank_id)
    if icon_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Icon not found for voicebank '{voicebank_id}'",
        )

    return FileResponse(
        path=icon_path,
        media_type="image/bmp",
        filename="icon.bmp",
    )


@router.delete(
    "/{voicebank_id}/icon",
    response_model=IconSuccessResponse,
)
async def delete_icon(
    voicebank_id: str,
    repository: Annotated[VoicebankRepository, Depends(get_voicebank_repository)],
) -> IconSuccessResponse:
    """Delete the voicebank icon.

    Removes icon.bmp from the voicebank directory.

    Args:
        voicebank_id: Slugified voicebank identifier

    Returns:
        Success confirmation

    Raises:
        HTTPException 404: If voicebank or icon not found
    """
    deleted = await repository.delete_icon(voicebank_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Icon not found for voicebank '{voicebank_id}'",
        )

    logger.info(f"Deleted icon for voicebank '{voicebank_id}'")
    return IconSuccessResponse(success=True)
