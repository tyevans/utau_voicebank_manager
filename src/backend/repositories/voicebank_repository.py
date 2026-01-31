"""Repository for voicebank storage and retrieval."""

import shutil
from datetime import datetime
from pathlib import Path

from src.backend.domain.voicebank import Voicebank, VoicebankSummary


class VoicebankRepository:
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
        if vb_path.exists():
            raise FileExistsError(f"Voicebank '{voicebank_id}' already exists")

        vb_path.mkdir(parents=True)

        # Write all files
        for filename, content in files.items():
            file_path = vb_path / filename
            # Ensure we don't write outside the voicebank directory
            if not file_path.resolve().is_relative_to(vb_path.resolve()):
                continue
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
