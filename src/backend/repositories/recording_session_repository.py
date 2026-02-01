"""Repository for recording session storage and retrieval."""

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionSummary,
    SessionStatus,
)


class RecordingSessionRepository:
    """Filesystem-based repository for recording session storage.

    Manages recording sessions stored as JSON metadata with audio segments
    stored as WAV files in subdirectories.

    Directory structure:
        base_path/
            sessions/
                {session_uuid}/
                    session.json   # Session metadata
                    segments/
                        0_prompt.wav
                        1_prompt.wav
                        ...
    """

    def __init__(self, base_path: Path) -> None:
        """Initialize repository with storage location.

        Args:
            base_path: Root directory for session storage (e.g., data/sessions)
        """
        self.base_path = base_path
        self.sessions_path = base_path / "sessions"
        self.sessions_path.mkdir(parents=True, exist_ok=True)

    def _session_dir(self, session_id: UUID) -> Path:
        """Get path to session directory."""
        return self.sessions_path / str(session_id)

    def _session_file(self, session_id: UUID) -> Path:
        """Get path to session metadata file."""
        return self._session_dir(session_id) / "session.json"

    def _segments_dir(self, session_id: UUID) -> Path:
        """Get path to segments directory."""
        return self._session_dir(session_id) / "segments"

    def _serialize_session(self, session: RecordingSession) -> dict:
        """Serialize session to JSON-compatible dict."""
        return {
            "id": str(session.id),
            "voicebank_id": session.voicebank_id,
            "recording_style": session.recording_style,
            "language": session.language,
            "recording_mode": session.recording_mode,
            "status": session.status.value,
            "prompts": session.prompts,
            "paragraph_ids": session.paragraph_ids,
            "segments": [
                {
                    "id": str(seg.id),
                    "prompt_index": seg.prompt_index,
                    "prompt_text": seg.prompt_text,
                    "audio_filename": seg.audio_filename,
                    "duration_ms": seg.duration_ms,
                    "recorded_at": seg.recorded_at.isoformat(),
                    "is_accepted": seg.is_accepted,
                    "rejection_reason": seg.rejection_reason,
                }
                for seg in session.segments
            ],
            "current_prompt_index": session.current_prompt_index,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
        }

    def _deserialize_session(self, data: dict) -> RecordingSession:
        """Deserialize session from JSON dict."""
        segments = [
            RecordingSegment(
                id=UUID(seg["id"]),
                prompt_index=seg["prompt_index"],
                prompt_text=seg["prompt_text"],
                audio_filename=seg["audio_filename"],
                duration_ms=seg["duration_ms"],
                recorded_at=datetime.fromisoformat(seg["recorded_at"]),
                is_accepted=seg["is_accepted"],
                rejection_reason=seg.get("rejection_reason"),
            )
            for seg in data.get("segments", [])
        ]

        return RecordingSession(
            id=UUID(data["id"]),
            voicebank_id=data["voicebank_id"],
            recording_style=data["recording_style"],
            language=data["language"],
            recording_mode=data.get("recording_mode", "individual"),
            status=SessionStatus(data["status"]),
            prompts=data["prompts"],
            paragraph_ids=data.get("paragraph_ids"),
            segments=segments,
            current_prompt_index=data.get("current_prompt_index", 0),
            created_at=datetime.fromisoformat(data["created_at"]),
            updated_at=datetime.fromisoformat(data["updated_at"]),
        )

    async def create(self, session: RecordingSession) -> RecordingSession:
        """Create a new recording session.

        Args:
            session: Session to create

        Returns:
            Created session

        Raises:
            FileExistsError: If session with this ID already exists
        """
        session_dir = self._session_dir(session.id)
        if session_dir.exists():
            raise FileExistsError(f"Session '{session.id}' already exists")

        # Create directory structure
        session_dir.mkdir(parents=True)
        self._segments_dir(session.id).mkdir()

        # Write session metadata
        session_file = self._session_file(session.id)
        session_file.write_text(json.dumps(self._serialize_session(session), indent=2))

        return session

    async def get_by_id(self, session_id: UUID) -> RecordingSession | None:
        """Get a session by its ID.

        Args:
            session_id: Session UUID

        Returns:
            Session if found, None otherwise
        """
        session_file = self._session_file(session_id)
        if not session_file.exists():
            return None

        data = json.loads(session_file.read_text())
        return self._deserialize_session(data)

    async def update(self, session: RecordingSession) -> RecordingSession:
        """Update an existing session.

        Args:
            session: Session with updated data

        Returns:
            Updated session

        Raises:
            FileNotFoundError: If session doesn't exist
        """
        session_file = self._session_file(session.id)
        if not session_file.exists():
            raise FileNotFoundError(f"Session '{session.id}' not found")

        # Update timestamp
        session.updated_at = datetime.now(UTC)

        # Write updated metadata
        session_file.write_text(json.dumps(self._serialize_session(session), indent=2))

        return session

    async def delete(self, session_id: UUID) -> bool:
        """Delete a session by ID.

        Args:
            session_id: Session UUID

        Returns:
            True if deleted, False if not found
        """
        session_dir = self._session_dir(session_id)
        if not session_dir.exists():
            return False

        shutil.rmtree(session_dir)
        return True

    async def list_all(self) -> list[RecordingSessionSummary]:
        """List all recording sessions.

        Returns:
            List of session summaries sorted by creation date (newest first)
        """
        sessions = []
        for item in self.sessions_path.iterdir():
            if item.is_dir():
                session_file = item / "session.json"
                if session_file.exists():
                    try:
                        data = json.loads(session_file.read_text())
                        session = self._deserialize_session(data)
                        sessions.append(session.to_summary())
                    except (json.JSONDecodeError, KeyError):
                        # Skip corrupted session files
                        continue

        return sorted(sessions, key=lambda s: s.created_at, reverse=True)

    async def list_by_voicebank(
        self, voicebank_id: str
    ) -> list[RecordingSessionSummary]:
        """List sessions for a specific voicebank.

        Args:
            voicebank_id: Voicebank identifier

        Returns:
            List of session summaries for the voicebank
        """
        all_sessions = await self.list_all()
        return [s for s in all_sessions if s.voicebank_id == voicebank_id]

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
        segments_dir = self._segments_dir(session_id)
        if not segments_dir.exists():
            raise FileNotFoundError(f"Session '{session_id}' not found")

        audio_path = segments_dir / filename
        # Security: ensure path is within segments directory
        if not audio_path.resolve().is_relative_to(segments_dir.resolve()):
            raise ValueError("Invalid filename")

        audio_path.write_bytes(audio_data)
        return audio_path

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
        segments_dir = self._segments_dir(session_id)
        if not segments_dir.exists():
            return None

        audio_path = segments_dir / filename
        # Security check
        if not audio_path.resolve().is_relative_to(segments_dir.resolve()):
            return None

        if not audio_path.exists():
            return None

        return audio_path

    async def exists(self, session_id: UUID) -> bool:
        """Check if a session exists.

        Args:
            session_id: Session UUID

        Returns:
            True if exists, False otherwise
        """
        return self._session_file(session_id).exists()
