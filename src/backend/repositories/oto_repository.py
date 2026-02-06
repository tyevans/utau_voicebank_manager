"""Repository for oto.ini file storage and retrieval."""

import asyncio
from pathlib import Path

from src.backend.domain.oto_entry import OtoEntry
from src.backend.repositories.interfaces import OtoRepositoryInterface
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.utils.lock_map import BoundedLockMap
from src.backend.utils.oto_parser import read_oto_file, write_oto_file


class OtoRepository(OtoRepositoryInterface):
    """Filesystem-based repository for oto.ini entry management.

    Reads and writes oto.ini files within voicebank directories.
    Uses the existing oto_parser utilities for file I/O.

    All mutating operations (create, update, delete, save) are serialized
    per voicebank_id using asyncio locks to prevent read-modify-write races.
    """

    def __init__(self, voicebank_repo: VoicebankRepository) -> None:
        """Initialize repository with voicebank repository.

        Args:
            voicebank_repo: VoicebankRepository for voicebank path resolution
        """
        self.voicebank_repo = voicebank_repo
        self._locks = BoundedLockMap(max_size=1024)

    def _get_lock(self, voicebank_id: str) -> asyncio.Lock:
        """Get or create an asyncio lock for a specific voicebank.

        Uses a bounded lock map with LRU eviction to prevent unbounded
        memory growth from accumulating locks for deleted voicebanks.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            asyncio.Lock for the given voicebank_id
        """
        return self._locks.get(voicebank_id)

    def _get_oto_path(self, voicebank_id: str) -> Path:
        """Get path to oto.ini file for a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            Path to oto.ini file (may not exist)
        """
        return self.voicebank_repo.base_path / voicebank_id / "oto.ini"

    async def voicebank_exists(self, voicebank_id: str) -> bool:
        """Check if a voicebank exists.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            True if voicebank exists
        """
        return await self.voicebank_repo.exists(voicebank_id)

    async def get_entries(self, voicebank_id: str) -> list[OtoEntry] | None:
        """Get all oto entries for a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of OtoEntry objects, empty list if oto.ini doesn't exist,
            or None if voicebank doesn't exist
        """
        if not await self.voicebank_exists(voicebank_id):
            return None

        oto_path = self._get_oto_path(voicebank_id)
        if not oto_path.exists():
            return []

        return read_oto_file(oto_path)

    async def get_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
    ) -> OtoEntry | None:
        """Get a specific oto entry by filename and alias.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename
            alias: Entry alias

        Returns:
            OtoEntry if found, None otherwise
        """
        entries = await self.get_entries(voicebank_id)
        if entries is None:
            return None

        for entry in entries:
            if entry.filename == filename and entry.alias == alias:
                return entry
        return None

    async def get_entries_for_file(
        self,
        voicebank_id: str,
        filename: str,
    ) -> list[OtoEntry] | None:
        """Get all oto entries for a specific WAV file.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename

        Returns:
            List of entries for the file, or None if voicebank doesn't exist
        """
        entries = await self.get_entries(voicebank_id)
        if entries is None:
            return None

        return [e for e in entries if e.filename == filename]

    def _write_entries(
        self,
        voicebank_id: str,
        entries: list[OtoEntry],
    ) -> None:
        """Write oto entries to disk (no locking).

        Internal helper -- callers must already hold the voicebank lock.

        Args:
            voicebank_id: Voicebank identifier
            entries: List of OtoEntry objects to write
        """
        oto_path = self._get_oto_path(voicebank_id)
        write_oto_file(oto_path, entries)

    async def save_entries(
        self,
        voicebank_id: str,
        entries: list[OtoEntry],
    ) -> None:
        """Save all oto entries for a voicebank, overwriting existing file.

        Acquires the per-voicebank lock to prevent races with concurrent
        create/update/delete operations.

        Args:
            voicebank_id: Voicebank identifier
            entries: List of OtoEntry objects to save
        """
        async with self._get_lock(voicebank_id):
            self._write_entries(voicebank_id, entries)

    async def create_entry(
        self,
        voicebank_id: str,
        entry: OtoEntry,
    ) -> OtoEntry:
        """Create a new oto entry.

        Args:
            voicebank_id: Voicebank identifier
            entry: OtoEntry to create

        Returns:
            Created OtoEntry

        Raises:
            ValueError: If entry with same filename+alias already exists
        """
        async with self._get_lock(voicebank_id):
            entries = await self.get_entries(voicebank_id)
            if entries is None:
                entries = []

            # Check for duplicate
            for existing in entries:
                if (
                    existing.filename == entry.filename
                    and existing.alias == entry.alias
                ):
                    raise ValueError(
                        f"Entry already exists: {entry.filename}={entry.alias}"
                    )

            entries.append(entry)
            self._write_entries(voicebank_id, entries)
            return entry

    async def update_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
        entry: OtoEntry,
    ) -> OtoEntry | None:
        """Update an existing oto entry.

        Args:
            voicebank_id: Voicebank identifier
            filename: Original WAV filename
            alias: Original entry alias
            entry: Updated OtoEntry (may have different filename/alias)

        Returns:
            Updated OtoEntry, or None if not found
        """
        async with self._get_lock(voicebank_id):
            entries = await self.get_entries(voicebank_id)
            if entries is None:
                return None

            # Find and replace the entry
            for i, existing in enumerate(entries):
                if existing.filename == filename and existing.alias == alias:
                    entries[i] = entry
                    self._write_entries(voicebank_id, entries)
                    return entry

            return None

    async def delete_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
    ) -> bool:
        """Delete an oto entry.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename
            alias: Entry alias

        Returns:
            True if deleted, False if not found
        """
        async with self._get_lock(voicebank_id):
            entries = await self.get_entries(voicebank_id)
            if entries is None:
                return False

            # Find and remove the entry
            original_count = len(entries)
            entries = [
                e for e in entries if not (e.filename == filename and e.alias == alias)
            ]

            if len(entries) == original_count:
                return False

            self._write_entries(voicebank_id, entries)
            return True

    async def wav_exists(self, voicebank_id: str, filename: str) -> bool:
        """Check if a WAV file exists in the voicebank.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename

        Returns:
            True if WAV file exists
        """
        sample_path = await self.voicebank_repo.get_sample_path(voicebank_id, filename)
        return sample_path is not None
