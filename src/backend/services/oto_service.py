"""Service layer for oto.ini business logic."""

from src.backend.domain.oto_entry import OtoEntry
from src.backend.repositories.oto_repository import OtoRepository


class OtoNotFoundError(Exception):
    """Raised when an oto entry is not found."""


class OtoEntryExistsError(Exception):
    """Raised when an oto entry already exists (duplicate filename+alias)."""


class OtoValidationError(Exception):
    """Raised when oto entry validation fails."""


class OtoService:
    """Business logic for oto.ini entry operations.

    Handles validation (WAV file existence, duplicate checks) and
    delegates storage to OtoRepository.
    """

    def __init__(self, repository: OtoRepository) -> None:
        """Initialize service with repository.

        Args:
            repository: OtoRepository for data access
        """
        self._repository = repository

    async def _ensure_voicebank_exists(self, voicebank_id: str) -> None:
        """Ensure voicebank exists, raise if not.

        Args:
            voicebank_id: Voicebank identifier

        Raises:
            OtoNotFoundError: If voicebank doesn't exist
        """
        if not await self._repository.voicebank_exists(voicebank_id):
            raise OtoNotFoundError(f"Voicebank '{voicebank_id}' not found")

    async def _validate_wav_exists(
        self,
        voicebank_id: str,
        filename: str,
    ) -> None:
        """Validate that the referenced WAV file exists.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename

        Raises:
            OtoValidationError: If WAV file doesn't exist
        """
        if not await self._repository.wav_exists(voicebank_id, filename):
            raise OtoValidationError(
                f"WAV file '{filename}' does not exist in voicebank '{voicebank_id}'"
            )

    async def get_entries(self, voicebank_id: str) -> list[OtoEntry]:
        """Get all oto entries for a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of OtoEntry objects (empty if oto.ini doesn't exist)

        Raises:
            OtoNotFoundError: If voicebank doesn't exist
        """
        await self._ensure_voicebank_exists(voicebank_id)

        entries = await self._repository.get_entries(voicebank_id)
        return entries if entries is not None else []

    async def get_entries_for_file(
        self,
        voicebank_id: str,
        filename: str,
    ) -> list[OtoEntry]:
        """Get all oto entries for a specific WAV file.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename

        Returns:
            List of entries for the file (empty if none found)

        Raises:
            OtoNotFoundError: If voicebank doesn't exist
        """
        await self._ensure_voicebank_exists(voicebank_id)

        entries = await self._repository.get_entries_for_file(voicebank_id, filename)
        return entries if entries is not None else []

    async def get_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
    ) -> OtoEntry:
        """Get a specific oto entry.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename
            alias: Entry alias

        Returns:
            OtoEntry

        Raises:
            OtoNotFoundError: If voicebank or entry doesn't exist
        """
        await self._ensure_voicebank_exists(voicebank_id)

        entry = await self._repository.get_entry(voicebank_id, filename, alias)
        if entry is None:
            raise OtoNotFoundError(
                f"Oto entry not found: {filename}={alias} in voicebank '{voicebank_id}'"
            )
        return entry

    async def create_entry(
        self,
        voicebank_id: str,
        entry: OtoEntry,
    ) -> OtoEntry:
        """Create a new oto entry.

        Validates that the referenced WAV file exists and that no duplicate
        entry exists for the same filename+alias combination.

        Args:
            voicebank_id: Voicebank identifier
            entry: OtoEntry to create

        Returns:
            Created OtoEntry

        Raises:
            OtoNotFoundError: If voicebank doesn't exist
            OtoValidationError: If WAV file doesn't exist
            OtoEntryExistsError: If entry with same filename+alias exists
        """
        await self._ensure_voicebank_exists(voicebank_id)
        await self._validate_wav_exists(voicebank_id, entry.filename)

        try:
            return await self._repository.create_entry(voicebank_id, entry)
        except ValueError as e:
            raise OtoEntryExistsError(str(e)) from e

    async def update_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
        offset: float | None = None,
        consonant: float | None = None,
        cutoff: float | None = None,
        preutterance: float | None = None,
        overlap: float | None = None,
    ) -> OtoEntry:
        """Update an existing oto entry.

        Only updates fields that are provided (not None).

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename
            alias: Entry alias
            offset: New offset value (optional)
            consonant: New consonant value (optional)
            cutoff: New cutoff value (optional)
            preutterance: New preutterance value (optional)
            overlap: New overlap value (optional)

        Returns:
            Updated OtoEntry

        Raises:
            OtoNotFoundError: If voicebank or entry doesn't exist
        """
        await self._ensure_voicebank_exists(voicebank_id)

        # Get existing entry
        existing = await self._repository.get_entry(voicebank_id, filename, alias)
        if existing is None:
            raise OtoNotFoundError(
                f"Oto entry not found: {filename}={alias} in voicebank '{voicebank_id}'"
            )

        # Create updated entry with new values or existing values
        updated = OtoEntry(
            filename=filename,
            alias=alias,
            offset=offset if offset is not None else existing.offset,
            consonant=consonant if consonant is not None else existing.consonant,
            cutoff=cutoff if cutoff is not None else existing.cutoff,
            preutterance=preutterance
            if preutterance is not None
            else existing.preutterance,
            overlap=overlap if overlap is not None else existing.overlap,
        )

        result = await self._repository.update_entry(
            voicebank_id, filename, alias, updated
        )
        if result is None:
            raise OtoNotFoundError(
                f"Oto entry not found: {filename}={alias} in voicebank '{voicebank_id}'"
            )
        return result

    async def delete_entry(
        self,
        voicebank_id: str,
        filename: str,
        alias: str,
    ) -> None:
        """Delete an oto entry.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename
            alias: Entry alias

        Raises:
            OtoNotFoundError: If voicebank or entry doesn't exist
        """
        await self._ensure_voicebank_exists(voicebank_id)

        deleted = await self._repository.delete_entry(voicebank_id, filename, alias)
        if not deleted:
            raise OtoNotFoundError(
                f"Oto entry not found: {filename}={alias} in voicebank '{voicebank_id}'"
            )
