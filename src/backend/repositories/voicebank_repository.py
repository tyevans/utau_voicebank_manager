"""Repository for voicebank storage and retrieval."""

import shutil
from datetime import datetime
from pathlib import Path

from src.backend.domain.voicebank import Voicebank, VoicebankSummary
from src.backend.repositories.interfaces import VoicebankRepositoryInterface


class VoicebankRepository(VoicebankRepositoryInterface):
    """Filesystem-based repository for voicebank storage.

    Manages voicebanks stored as subdirectories containing WAV files
    and optional oto.ini configuration.

    Directory structure:
        base_path/
            voicebank_id/
                oto.ini (optional)
                sample1.wav
                sample2.wav
                ...
    """

    def __init__(self, base_path: Path) -> None:
        """Initialize repository with storage location.

        Args:
            base_path: Root directory for voicebank storage (e.g., data/voicebanks)
        """
        self.base_path = base_path
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _count_wav_files(self, path: Path) -> int:
        """Count WAV files in a directory."""
        return len(list(path.glob("*.wav"))) + len(list(path.glob("*.WAV")))

    def _has_oto_ini(self, path: Path) -> bool:
        """Check if oto.ini exists in directory."""
        return (path / "oto.ini").exists()

    def _get_created_at(self, path: Path) -> datetime:
        """Get directory creation time."""
        stat = path.stat()
        # Use ctime (metadata change time) as creation time proxy
        return datetime.fromtimestamp(stat.st_ctime)

    def _build_voicebank(self, vb_path: Path) -> Voicebank:
        """Build Voicebank model from directory path."""
        return Voicebank(
            id=vb_path.name,
            name=vb_path.name,  # Default to directory name
            path=vb_path.resolve(),
            sample_count=self._count_wav_files(vb_path),
            has_oto=self._has_oto_ini(vb_path),
            created_at=self._get_created_at(vb_path),
        )

    def _build_summary(self, vb_path: Path) -> VoicebankSummary:
        """Build VoicebankSummary model from directory path."""
        return VoicebankSummary(
            id=vb_path.name,
            name=vb_path.name,
            sample_count=self._count_wav_files(vb_path),
            has_oto=self._has_oto_ini(vb_path),
        )

    async def list_all(self) -> list[VoicebankSummary]:
        """List all voicebanks in the storage directory.

        Returns:
            List of voicebank summaries sorted by name
        """
        voicebanks = []
        for item in self.base_path.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                voicebanks.append(self._build_summary(item))

        return sorted(voicebanks, key=lambda vb: vb.name.lower())

    async def get_by_id(self, voicebank_id: str) -> Voicebank | None:
        """Get a voicebank by its ID.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            Voicebank if found, None otherwise
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return None
        return self._build_voicebank(vb_path)

    async def create(
        self,
        voicebank_id: str,
        name: str,
        files: dict[str, bytes],
    ) -> Voicebank:
        """Create a new voicebank with the provided files.

        Args:
            voicebank_id: Slugified identifier for the voicebank
            name: Display name for the voicebank
            files: Dictionary mapping filenames to file contents

        Returns:
            Created Voicebank

        Raises:
            FileExistsError: If voicebank with this ID already exists
        """
        vb_path = self.base_path / voicebank_id
        try:
            vb_path.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            raise FileExistsError(
                f"Voicebank '{voicebank_id}' already exists"
            ) from None

        # Write all files
        for filename, content in files.items():
            file_path = vb_path / filename
            # Reject path traversal attempts
            if not file_path.resolve().is_relative_to(vb_path.resolve()):
                raise ValueError(
                    f"Path traversal detected: '{filename}' resolves outside voicebank directory"
                )
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(content)

        voicebank = self._build_voicebank(vb_path)
        # Override name with provided display name
        return Voicebank(
            id=voicebank.id,
            name=name,
            path=voicebank.path,
            sample_count=voicebank.sample_count,
            has_oto=voicebank.has_oto,
            created_at=voicebank.created_at,
        )

    async def delete(self, voicebank_id: str) -> bool:
        """Delete a voicebank by ID.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if deleted, False if not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return False

        shutil.rmtree(vb_path)
        return True

    async def list_samples(self, voicebank_id: str) -> list[str] | None:
        """List WAV sample filenames in a voicebank.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            List of WAV filenames sorted alphabetically, or None if not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return None

        samples = []
        for wav_file in vb_path.glob("*.wav"):
            samples.append(wav_file.name)
        for wav_file in vb_path.glob("*.WAV"):
            samples.append(wav_file.name)

        return sorted(set(samples), key=str.lower)

    async def get_sample_path(self, voicebank_id: str, filename: str) -> Path | None:
        """Get the absolute path to a sample file.

        Args:
            voicebank_id: Slugified voicebank identifier
            filename: WAV filename

        Returns:
            Absolute path to the sample, or None if not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return None

        sample_path = vb_path / filename
        # Security: ensure path is within voicebank directory
        if not sample_path.resolve().is_relative_to(vb_path.resolve()):
            return None

        if not sample_path.exists() or not sample_path.is_file():
            return None

        return sample_path.resolve()

    async def exists(self, voicebank_id: str) -> bool:
        """Check if a voicebank exists.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if exists, False otherwise
        """
        vb_path = self.base_path / voicebank_id
        return vb_path.exists() and vb_path.is_dir()

    # Allowed metadata filenames to prevent path traversal
    ALLOWED_METADATA_FILES: frozenset[str] = frozenset({"character.txt", "readme.txt"})

    def _validate_metadata_filename(self, filename: str) -> None:
        """Validate that the filename is an allowed metadata file.

        Args:
            filename: Metadata filename to validate

        Raises:
            ValueError: If filename is not in the allowed set
        """
        if filename not in self.ALLOWED_METADATA_FILES:
            raise ValueError(
                f"Invalid metadata filename '{filename}'. "
                f"Allowed: {', '.join(sorted(self.ALLOWED_METADATA_FILES))}"
            )

    async def get_metadata_file(self, voicebank_id: str, filename: str) -> str | None:
        """Read character.txt or readme.txt content from a voicebank.

        Args:
            voicebank_id: Slugified voicebank identifier
            filename: Metadata filename ("character.txt" or "readme.txt")

        Returns:
            File content as string, or None if voicebank not found.
            Returns empty string if voicebank exists but file does not.

        Raises:
            ValueError: If filename is not an allowed metadata file
        """
        self._validate_metadata_filename(filename)

        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return None

        file_path = vb_path / filename
        if not file_path.exists() or not file_path.is_file():
            return ""

        return file_path.read_text(encoding="utf-8")

    async def save_metadata_file(
        self, voicebank_id: str, filename: str, content: str
    ) -> bool:
        """Write character.txt or readme.txt content to a voicebank.

        Args:
            voicebank_id: Slugified voicebank identifier
            filename: Metadata filename ("character.txt" or "readme.txt")
            content: File content to write

        Returns:
            True if written successfully, False if voicebank not found

        Raises:
            ValueError: If filename is not an allowed metadata file
        """
        self._validate_metadata_filename(filename)

        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return False

        file_path = vb_path / filename
        file_path.write_text(content, encoding="utf-8")
        return True

    # Icon file management

    ICON_FILENAME: str = "icon.bmp"

    async def save_icon(self, voicebank_id: str, icon_data: bytes) -> bool:
        """Save icon.bmp to a voicebank directory.

        Args:
            voicebank_id: Slugified voicebank identifier
            icon_data: Raw BMP image bytes to write

        Returns:
            True if saved successfully, False if voicebank not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return False

        icon_path = vb_path / self.ICON_FILENAME
        icon_path.write_bytes(icon_data)
        return True

    async def get_icon_path(self, voicebank_id: str) -> Path | None:
        """Get the absolute path to a voicebank's icon.bmp.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            Absolute path to icon.bmp, or None if voicebank or icon not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return None

        icon_path = vb_path / self.ICON_FILENAME
        if not icon_path.exists() or not icon_path.is_file():
            return None

        return icon_path.resolve()

    async def delete_icon(self, voicebank_id: str) -> bool:
        """Delete icon.bmp from a voicebank directory.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if deleted successfully, False if voicebank or icon not found
        """
        vb_path = self.base_path / voicebank_id
        if not vb_path.exists() or not vb_path.is_dir():
            return False

        icon_path = vb_path / self.ICON_FILENAME
        if not icon_path.exists() or not icon_path.is_file():
            return False

        icon_path.unlink()
        return True
