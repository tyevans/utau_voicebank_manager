"""Service layer for voicebank business logic."""

import io
import zipfile
from pathlib import Path

from slugify import slugify

from src.backend.domain.voicebank import Voicebank, VoicebankSummary
from src.backend.repositories.interfaces import VoicebankRepositoryInterface


class VoicebankValidationError(Exception):
    """Raised when voicebank validation fails."""


class VoicebankNotFoundError(Exception):
    """Raised when a voicebank is not found."""


class VoicebankExistsError(Exception):
    """Raised when a voicebank with the same ID already exists."""


class VoicebankService:
    """Business logic for voicebank operations.

    Handles validation, ZIP extraction, and delegates storage to repository.
    """

    def __init__(self, repository: VoicebankRepositoryInterface) -> None:
        """Initialize service with repository.

        Args:
            repository: VoicebankRepositoryInterface for data access
        """
        self._repository = repository

    def _slugify_name(self, name: str) -> str:
        """Convert display name to URL-safe slug ID.

        Args:
            name: Human-readable voicebank name

        Returns:
            Slugified ID suitable for directory names and URLs
        """
        return slugify(name, lowercase=True, separator="_")

    def _decode_zip_filename(self, info: zipfile.ZipInfo) -> str:
        """Decode ZIP filename handling Japanese Shift-JIS encoding.

        Japanese UTAU voicebanks typically use Shift-JIS (CP932) encoding for
        filenames, but Python's zipfile defaults to CP437 when UTF-8 flag is not set.

        Args:
            info: ZipInfo object containing filename

        Returns:
            Properly decoded filename
        """
        # If UTF-8 flag is set (bit 11), the filename is already correct
        if info.flag_bits & 0x800:
            return info.filename

        # Otherwise, try to decode as Shift-JIS (CP932) for Japanese
        # The filename was incorrectly decoded from CP437, so we:
        # 1. Encode back to bytes using CP437
        # 2. Decode using Shift-JIS (CP932)
        try:
            raw_bytes = info.filename.encode("cp437")
            return raw_bytes.decode("cp932")
        except (UnicodeDecodeError, UnicodeEncodeError):
            # Fall back to original filename if decoding fails
            return info.filename

    def _extract_zip(self, zip_content: bytes) -> dict[str, bytes]:
        """Extract files from a ZIP archive.

        Handles Japanese Shift-JIS encoded filenames commonly found in UTAU
        voicebanks distributed from Japan.

        Args:
            zip_content: Raw ZIP file bytes

        Returns:
            Dictionary mapping filenames to contents

        Raises:
            VoicebankValidationError: If ZIP is invalid or contains no valid files
        """
        try:
            files: dict[str, bytes] = {}
            with zipfile.ZipFile(io.BytesIO(zip_content)) as zf:
                for info in zf.infolist():
                    # Skip directories
                    if info.is_dir():
                        continue
                    # Decode filename handling Japanese encoding
                    filename = self._decode_zip_filename(info)
                    # Skip hidden files and macOS metadata
                    if filename.startswith(".") or "__MACOSX" in filename:
                        continue
                    files[filename] = zf.read(info)
            return files
        except zipfile.BadZipFile as e:
            raise VoicebankValidationError("Invalid ZIP file") from e

    def _normalize_zip_paths(self, files: dict[str, bytes]) -> dict[str, bytes]:
        """Normalize file paths from ZIP to remove common root directory.

        If all files share a common root directory, strip it.

        Args:
            files: Dictionary mapping paths to contents

        Returns:
            Dictionary with normalized paths
        """
        if not files:
            return files

        # Find common prefix directory
        paths = list(files.keys())
        first_parts = paths[0].split("/")

        if len(first_parts) > 1:
            common_root = first_parts[0]
            all_share_root = all(p.startswith(f"{common_root}/") for p in paths)

            if all_share_root:
                # Strip the common root
                prefix_len = len(common_root) + 1
                return {p[prefix_len:]: content for p, content in files.items()}

        return files

    def _validate_files(self, files: dict[str, bytes]) -> None:
        """Validate that files contain at least one WAV.

        Args:
            files: Dictionary mapping filenames to contents

        Raises:
            VoicebankValidationError: If no WAV files found
        """
        wav_count = sum(1 for f in files if f.lower().endswith(".wav"))
        if wav_count == 0:
            raise VoicebankValidationError(
                "Voicebank must contain at least one WAV file"
            )

    async def list_all(self) -> list[VoicebankSummary]:
        """List all voicebanks.

        Returns:
            List of voicebank summaries
        """
        return await self._repository.list_all()

    async def get(self, voicebank_id: str) -> Voicebank:
        """Get a voicebank by ID.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            Voicebank details

        Raises:
            VoicebankNotFoundError: If voicebank not found
        """
        voicebank = await self._repository.get_by_id(voicebank_id)
        if voicebank is None:
            raise VoicebankNotFoundError(f"Voicebank '{voicebank_id}' not found")
        return voicebank

    async def create(
        self,
        name: str,
        files: dict[str, bytes] | None = None,
        zip_content: bytes | None = None,
    ) -> Voicebank:
        """Create a new voicebank.

        Accepts either individual files or a ZIP archive containing files.

        Args:
            name: Display name for the voicebank
            files: Dictionary mapping filenames to contents
            zip_content: Raw ZIP file bytes (alternative to files)

        Returns:
            Created Voicebank

        Raises:
            VoicebankValidationError: If validation fails
            VoicebankExistsError: If voicebank with same ID exists
        """
        voicebank_id = self._slugify_name(name)

        if not voicebank_id:
            raise VoicebankValidationError("Invalid voicebank name")

        # Check if already exists
        if await self._repository.exists(voicebank_id):
            raise VoicebankExistsError(
                f"Voicebank with ID '{voicebank_id}' already exists"
            )

        # Extract files from ZIP if provided
        if zip_content is not None:
            files = self._extract_zip(zip_content)
            files = self._normalize_zip_paths(files)
        elif files is None:
            files = {}

        # Validate files
        self._validate_files(files)

        try:
            return await self._repository.create(voicebank_id, name, files)
        except FileExistsError as e:
            raise VoicebankExistsError(str(e)) from e

    async def delete(self, voicebank_id: str) -> None:
        """Delete a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Raises:
            VoicebankNotFoundError: If voicebank not found
        """
        deleted = await self._repository.delete(voicebank_id)
        if not deleted:
            raise VoicebankNotFoundError(f"Voicebank '{voicebank_id}' not found")

    async def list_samples(self, voicebank_id: str) -> list[str]:
        """List WAV sample filenames in a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of WAV filenames

        Raises:
            VoicebankNotFoundError: If voicebank not found
        """
        samples = await self._repository.list_samples(voicebank_id)
        if samples is None:
            raise VoicebankNotFoundError(f"Voicebank '{voicebank_id}' not found")
        return samples

    async def get_sample_path(self, voicebank_id: str, filename: str) -> Path:
        """Get path to a sample file.

        Args:
            voicebank_id: Voicebank identifier
            filename: Sample filename

        Returns:
            Absolute path to sample file

        Raises:
            VoicebankNotFoundError: If voicebank or sample not found
        """
        sample_path = await self._repository.get_sample_path(voicebank_id, filename)
        if sample_path is None:
            raise VoicebankNotFoundError(
                f"Sample '{filename}' not found in voicebank '{voicebank_id}'"
            )
        return sample_path
