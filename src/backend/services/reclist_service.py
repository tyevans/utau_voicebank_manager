"""Service layer for recording list parsing and preview.

Provides business logic for importing custom recording lists.
This is a stateless parse-and-preview flow -- no persistence is involved.
"""

import logging

from src.backend.domain.recording_list import ReclistParseRequest, RecordingList
from src.backend.utils.reclist_parser import (
    ReclistParseError,
    decode_reclist_bytes,
    parse_reclist,
)

logger = logging.getLogger(__name__)


class ReclistValidationError(Exception):
    """Raised when recording list validation fails."""


class ReclistService:
    """Business logic for custom recording list operations.

    Handles parsing uploaded recording list files and returning
    structured preview data for the frontend.
    """

    async def parse_upload(
        self,
        file_data: bytes,
        request: ReclistParseRequest,
    ) -> RecordingList:
        """Parse an uploaded recording list file and return a preview.

        Decodes the file content, auto-detects the format, parses
        entries, and returns a structured RecordingList for preview.
        Does not persist anything.

        Args:
            file_data: Raw bytes of the uploaded file.
            request: Metadata about the recording list (name, language, style).

        Returns:
            Parsed RecordingList with entries and metadata.

        Raises:
            ReclistValidationError: If the file cannot be parsed or is invalid.
        """
        # Decode bytes to text
        try:
            content = decode_reclist_bytes(file_data)
        except ReclistParseError as e:
            raise ReclistValidationError(str(e)) from e

        # Parse the content
        try:
            entries, detected_format, warnings = parse_reclist(content)
        except ReclistParseError as e:
            raise ReclistValidationError(str(e)) from e

        logger.info(
            "Parsed recording list '%s': %d entries, format=%s, %d warnings",
            request.name,
            len(entries),
            detected_format,
            len(warnings),
        )

        return RecordingList(
            name=request.name,
            language=request.language,
            style=request.style,
            format_detected=detected_format,
            entries=entries,
            warnings=warnings,
        )
