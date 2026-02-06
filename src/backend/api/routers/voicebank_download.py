"""API router for voicebank download functionality.

Provides endpoints for downloading voicebanks as ZIP archives containing
all WAV samples and the current oto.ini configuration.
"""

import logging
import tempfile
import zipfile
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from src.backend.api.dependencies import get_oto_repository, get_voicebank_service
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.services.voicebank_service import (
    VoicebankNotFoundError,
    VoicebankService,
)
from src.backend.utils.oto_parser import serialize_oto_entries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voicebanks", tags=["voicebanks"])


async def create_voicebank_zip(
    voicebank_path: Path,
    oto_entries_content: str | None,
) -> AsyncGenerator[bytes, None]:
    """Create a ZIP archive of voicebank files as a streaming generator.

    Generates ZIP content in memory and yields it in chunks for efficient
    streaming to the client.

    Args:
        voicebank_path: Absolute path to the voicebank directory
        oto_entries_content: Serialized oto.ini content (None if no entries)

    Yields:
        Chunks of ZIP file bytes
    """
    # Write ZIP to a temporary file instead of memory to avoid OOM on large voicebanks
    tmp = tempfile.SpooledTemporaryFile(
        max_size=10 * 1024 * 1024
    )  # 10MB in-memory, then spill to disk

    try:
        with zipfile.ZipFile(tmp, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            # Add all WAV files
            for wav_file in voicebank_path.glob("*.wav"):
                zf.write(wav_file, arcname=wav_file.name)

            # Also check for uppercase .WAV extension
            for wav_file in voicebank_path.glob("*.WAV"):
                zf.write(wav_file, arcname=wav_file.name)

            # Add oto.ini with current entries
            if oto_entries_content:
                zf.writestr("oto.ini", oto_entries_content.encode("utf-8"))

            # Add metadata files (character.txt, readme.txt) if they exist
            for metadata_filename in ("character.txt", "readme.txt"):
                metadata_path = voicebank_path / metadata_filename
                if metadata_path.exists() and metadata_path.is_file():
                    zf.write(metadata_path, arcname=metadata_filename)

            # Add icon.bmp if it exists
            icon_path = voicebank_path / "icon.bmp"
            if icon_path.exists() and icon_path.is_file():
                zf.write(icon_path, arcname="icon.bmp")

        # Seek to beginning and yield content in chunks
        tmp.seek(0)
        chunk_size = 64 * 1024  # 64KB chunks

        while True:
            chunk = tmp.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        tmp.close()


@router.get(
    "/{voicebank_id}/download",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "ZIP archive containing voicebank files",
            "content": {"application/zip": {}},
        },
        404: {
            "description": "Voicebank not found",
            "content": {
                "application/json": {
                    "example": {"detail": "Voicebank 'my_voice' not found"}
                }
            },
        },
    },
)
async def download_voicebank(
    voicebank_id: str,
    service: Annotated[VoicebankService, Depends(get_voicebank_service)],
    oto_repo: Annotated[OtoRepository, Depends(get_oto_repository)],
) -> StreamingResponse:
    """Download a voicebank as a ZIP archive.

    Creates a ZIP file containing all WAV samples and the current oto.ini
    configuration. The oto.ini reflects the latest edits made in the UI,
    not necessarily what was originally uploaded.

    The ZIP structure is flat (no subdirectories):
    - sample1.wav
    - sample2.wav
    - ...
    - oto.ini

    Args:
        voicebank_id: Slugified voicebank identifier

    Returns:
        StreamingResponse with ZIP file content

    Raises:
        HTTPException 404: If voicebank not found
    """
    try:
        voicebank = await service.get(voicebank_id)
    except VoicebankNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    # Get current oto entries
    oto_entries = await oto_repo.get_entries(voicebank_id)
    oto_content: str | None = None

    if oto_entries:
        oto_content = serialize_oto_entries(oto_entries) + "\n"

    logger.info(
        f"Downloading voicebank '{voicebank_id}' with {voicebank.sample_count} samples "
        f"and {len(oto_entries) if oto_entries else 0} oto entries"
    )

    # Generate filename for download
    download_filename = f"{voicebank_id}.zip"

    return StreamingResponse(
        create_voicebank_zip(voicebank.path, oto_content),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{download_filename}"',
        },
    )
