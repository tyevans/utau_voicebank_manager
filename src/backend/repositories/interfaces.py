"""Abstract base classes for repository interfaces.

Defines the contracts that concrete repository implementations must fulfill.
Services depend on these interfaces (not concrete classes) to enable proper
Dependency Inversion and easier testing/mocking.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from uuid import UUID

from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.recording_session import (
    RecordingSession,
    RecordingSessionSummary,
)
from src.backend.domain.voicebank import Voicebank, VoicebankSummary


class VoicebankRepositoryInterface(ABC):
    """Abstract interface for voicebank storage and retrieval.

    Manages voicebanks stored as subdirectories containing WAV files
    and optional oto.ini configuration.
    """

    @abstractmethod
    async def list_all(self) -> list[VoicebankSummary]:
        """List all voicebanks in the storage directory.

        Returns:
            List of voicebank summaries sorted by name
        """
        ...

    @abstractmethod
    async def get_by_id(self, voicebank_id: str) -> Voicebank | None:
        """Get a voicebank by its ID.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            Voicebank if found, None otherwise
        """
        ...

    @abstractmethod
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
        ...

    @abstractmethod
    async def delete(self, voicebank_id: str) -> bool:
        """Delete a voicebank by ID.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if deleted, False if not found
        """
        ...

    @abstractmethod
    async def list_samples(self, voicebank_id: str) -> list[str] | None:
        """List WAV sample filenames in a voicebank.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            List of WAV filenames sorted alphabetically, or None if not found
        """
        ...

    @abstractmethod
    async def get_sample_path(self, voicebank_id: str, filename: str) -> Path | None:
        """Get the absolute path to a sample file.

        Args:
            voicebank_id: Slugified voicebank identifier
            filename: WAV filename

        Returns:
            Absolute path to the sample, or None if not found
        """
        ...

    @abstractmethod
    async def exists(self, voicebank_id: str) -> bool:
        """Check if a voicebank exists.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if exists, False otherwise
        """
        ...

    @abstractmethod
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
        ...

    @abstractmethod
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
        ...

    @abstractmethod
    async def save_icon(self, voicebank_id: str, icon_data: bytes) -> bool:
        """Save icon.bmp to a voicebank directory.

        Args:
            voicebank_id: Slugified voicebank identifier
            icon_data: Raw BMP image bytes to write

        Returns:
            True if saved successfully, False if voicebank not found
        """
        ...

    @abstractmethod
    async def get_icon_path(self, voicebank_id: str) -> Path | None:
        """Get the absolute path to a voicebank's icon.bmp.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            Absolute path to icon.bmp, or None if voicebank or icon not found
        """
        ...

    @abstractmethod
    async def delete_icon(self, voicebank_id: str) -> bool:
        """Delete icon.bmp from a voicebank directory.

        Args:
            voicebank_id: Slugified voicebank identifier

        Returns:
            True if deleted successfully, False if voicebank or icon not found
        """
        ...


class OtoRepositoryInterface(ABC):
    """Abstract interface for oto.ini entry management.

    Reads and writes oto.ini files within voicebank directories.
    """

    @abstractmethod
    async def voicebank_exists(self, voicebank_id: str) -> bool:
        """Check if a voicebank exists.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            True if voicebank exists
        """
        ...

    @abstractmethod
    async def get_entries(self, voicebank_id: str) -> list[OtoEntry] | None:
        """Get all oto entries for a voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of OtoEntry objects, empty list if oto.ini doesn't exist,
            or None if voicebank doesn't exist
        """
        ...

    @abstractmethod
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
        ...

    @abstractmethod
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
        ...

    @abstractmethod
    async def save_entries(
        self,
        voicebank_id: str,
        entries: list[OtoEntry],
    ) -> None:
        """Save all oto entries for a voicebank, overwriting existing file.

        Args:
            voicebank_id: Voicebank identifier
            entries: List of OtoEntry objects to save
        """
        ...

    @abstractmethod
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
        ...

    @abstractmethod
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
        ...

    @abstractmethod
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
        ...

    @abstractmethod
    async def wav_exists(self, voicebank_id: str, filename: str) -> bool:
        """Check if a WAV file exists in the voicebank.

        Args:
            voicebank_id: Voicebank identifier
            filename: WAV filename

        Returns:
            True if WAV file exists
        """
        ...


class RecordingSessionRepositoryInterface(ABC):
    """Abstract interface for recording session storage and retrieval.

    Manages recording sessions with audio segments stored as WAV files.
    """

    @abstractmethod
    async def create(self, session: RecordingSession) -> RecordingSession:
        """Create a new recording session.

        Args:
            session: Session to create

        Returns:
            Created session

        Raises:
            FileExistsError: If session with this ID already exists
        """
        ...

    @abstractmethod
    async def get_by_id(self, session_id: UUID) -> RecordingSession | None:
        """Get a session by its ID.

        Args:
            session_id: Session UUID

        Returns:
            Session if found, None otherwise
        """
        ...

    @abstractmethod
    async def update(self, session: RecordingSession) -> RecordingSession:
        """Update an existing session.

        Args:
            session: Session with updated data

        Returns:
            Updated session

        Raises:
            FileNotFoundError: If session doesn't exist
        """
        ...

    @abstractmethod
    async def delete(self, session_id: UUID) -> bool:
        """Delete a session by ID.

        Args:
            session_id: Session UUID

        Returns:
            True if deleted, False if not found
        """
        ...

    @abstractmethod
    async def list_all(self) -> list[RecordingSessionSummary]:
        """List all recording sessions.

        Returns:
            List of session summaries sorted by creation date (newest first)
        """
        ...

    @abstractmethod
    async def list_by_voicebank(
        self, voicebank_id: str
    ) -> list[RecordingSessionSummary]:
        """List sessions for a specific voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of session summaries for the voicebank
        """
        ...

    @abstractmethod
    async def save_segment_audio(
        self,
        session_id: UUID,
        filename: str,
        audio_data: bytes,
    ) -> Path:
        """Save audio data for a segment.

        Args:
            session_id: Session UUID
            filename: Filename for the audio (e.g., "0_ka.wav")
            audio_data: Raw WAV audio bytes

        Returns:
            Path to saved audio file

        Raises:
            FileNotFoundError: If session doesn't exist
        """
        ...

    @abstractmethod
    async def get_segment_audio_path(
        self,
        session_id: UUID,
        filename: str,
    ) -> Path | None:
        """Get path to a segment's audio file.

        Args:
            session_id: Session UUID
            filename: Audio filename

        Returns:
            Path to audio file, or None if not found
        """
        ...

    @abstractmethod
    async def exists(self, session_id: UUID) -> bool:
        """Check if a session exists.

        Args:
            session_id: Session UUID

        Returns:
            True if exists, False otherwise
        """
        ...
