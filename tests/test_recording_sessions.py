"""Tests for recording session API and service layer."""

import tempfile
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    SegmentUpload,
    SessionStatus,
)
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionNotFoundError,
    SessionStateError,
    SessionValidationError,
    VoicebankNotFoundError,
)


class TestRecordingSessionModels:
    """Tests for recording session Pydantic models."""

    def test_create_session(self) -> None:
        """Test creating a RecordingSession."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        assert session.voicebank_id == "test_vb"
        assert session.recording_style == "cv"
        assert session.language == "ja"
        assert len(session.prompts) == 3
        assert session.status == SessionStatus.PENDING
        assert session.segments == []

    def test_session_progress(self) -> None:
        """Test session progress calculation."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta", "na"],
        )
        assert session.progress_percent == 0.0
        assert not session.is_complete

        # Add accepted segments
        session.segments.append(
            RecordingSegment(
                prompt_index=0,
                prompt_text="ka",
                audio_filename="0000_ka.wav",
                duration_ms=1000.0,
            )
        )
        assert session.progress_percent == 25.0

        session.segments.append(
            RecordingSegment(
                prompt_index=1,
                prompt_text="sa",
                audio_filename="0001_sa.wav",
                duration_ms=1000.0,
            )
        )
        assert session.progress_percent == 50.0

    def test_session_to_summary(self) -> None:
        """Test converting session to summary."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        session.segments.append(
            RecordingSegment(
                prompt_index=0,
                prompt_text="ka",
                audio_filename="0000_ka.wav",
                duration_ms=1000.0,
            )
        )

        summary = session.to_summary()
        assert summary.voicebank_id == "test_vb"
        assert summary.status == SessionStatus.PENDING
        assert summary.total_prompts == 3
        assert summary.completed_segments == 1

    def test_recording_segment(self) -> None:
        """Test creating a RecordingSegment."""
        segment = RecordingSegment(
            prompt_index=0,
            prompt_text="ka",
            audio_filename="0000_ka.wav",
            duration_ms=1500.0,
        )
        assert segment.prompt_index == 0
        assert segment.prompt_text == "ka"
        assert segment.audio_filename == "0000_ka.wav"
        assert segment.duration_ms == 1500.0
        assert segment.is_accepted is True
        assert segment.rejection_reason is None

    def test_session_create_request(self) -> None:
        """Test RecordingSessionCreate request model."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="vcv",
            language="ja",
            prompts=["a ka", "a sa", "a ta"],
        )
        assert request.voicebank_id == "test_vb"
        assert request.recording_style == "vcv"
        assert request.language == "ja"
        assert len(request.prompts) == 3


class TestRecordingSessionRepository:
    """Tests for RecordingSessionRepository."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def repository(self, temp_dir: Path) -> RecordingSessionRepository:
        """Create a repository instance."""
        return RecordingSessionRepository(temp_dir)

    @pytest.mark.asyncio
    async def test_create_session(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test creating a session in repository."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        created = await repository.create(session)
        assert created.id == session.id
        assert created.voicebank_id == "test_vb"

    @pytest.mark.asyncio
    async def test_get_session(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test retrieving a session."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        await repository.create(session)

        retrieved = await repository.get_by_id(session.id)
        assert retrieved is not None
        assert retrieved.id == session.id
        assert retrieved.voicebank_id == session.voicebank_id
        assert retrieved.prompts == session.prompts

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test retrieving a nonexistent session returns None."""
        result = await repository.get_by_id(uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_update_session(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test updating a session."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        await repository.create(session)

        session.status = SessionStatus.RECORDING
        session.current_prompt_index = 1
        await repository.update(session)

        retrieved = await repository.get_by_id(session.id)
        assert retrieved is not None
        assert retrieved.status == SessionStatus.RECORDING
        assert retrieved.current_prompt_index == 1

    @pytest.mark.asyncio
    async def test_delete_session(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test deleting a session."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        await repository.create(session)

        deleted = await repository.delete(session.id)
        assert deleted is True

        # Should be gone
        result = await repository.get_by_id(session.id)
        assert result is None

    @pytest.mark.asyncio
    async def test_list_sessions(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test listing all sessions."""
        # Create multiple sessions
        for i in range(3):
            session = RecordingSession(
                voicebank_id=f"vb_{i}",
                recording_style="cv",
                language="ja",
                prompts=["ka"],
            )
            await repository.create(session)

        sessions = await repository.list_all()
        assert len(sessions) == 3

    @pytest.mark.asyncio
    async def test_save_segment_audio(
        self, repository: RecordingSessionRepository
    ) -> None:
        """Test saving segment audio."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        await repository.create(session)

        # Create minimal valid WAV header
        wav_data = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32

        path = await repository.save_segment_audio(
            session.id, "0000_ka.wav", wav_data
        )
        assert path.exists()
        assert path.name == "0000_ka.wav"


class TestRecordingSessionService:
    """Tests for RecordingSessionService."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def voicebank_repo(self, temp_dir: Path) -> VoicebankRepository:
        """Create a voicebank repository with a test voicebank."""
        repo = VoicebankRepository(temp_dir / "voicebanks")
        # Create a test voicebank directory
        vb_dir = temp_dir / "voicebanks" / "test_vb"
        vb_dir.mkdir(parents=True)
        # Add a dummy WAV file
        (vb_dir / "test.wav").write_bytes(b"RIFF" + b"\x00" * 40 + b"WAVE")
        return repo

    @pytest.fixture
    def session_repo(self, temp_dir: Path) -> RecordingSessionRepository:
        """Create a session repository."""
        return RecordingSessionRepository(temp_dir / "sessions")

    @pytest.fixture
    def service(
        self,
        session_repo: RecordingSessionRepository,
        voicebank_repo: VoicebankRepository,
    ) -> RecordingSessionService:
        """Create a service instance."""
        return RecordingSessionService(session_repo, voicebank_repo)

    @pytest.mark.asyncio
    async def test_create_session(
        self, service: RecordingSessionService
    ) -> None:
        """Test creating a session through service."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta"],
        )
        session = await service.create(request)
        assert session.voicebank_id == "test_vb"
        assert session.recording_style == "cv"
        assert session.status == SessionStatus.PENDING

    @pytest.mark.asyncio
    async def test_create_session_invalid_voicebank(
        self, service: RecordingSessionService
    ) -> None:
        """Test creating a session with nonexistent voicebank."""
        request = RecordingSessionCreate(
            voicebank_id="nonexistent",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        with pytest.raises(VoicebankNotFoundError):
            await service.create(request)

    @pytest.mark.asyncio
    async def test_create_session_invalid_style(
        self, service: RecordingSessionService
    ) -> None:
        """Test creating a session with invalid recording style."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="invalid",
            language="ja",
            prompts=["ka"],
        )
        with pytest.raises(SessionValidationError):
            await service.create(request)

    @pytest.mark.asyncio
    async def test_create_session_invalid_language(
        self, service: RecordingSessionService
    ) -> None:
        """Test creating a session with invalid language."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="invalid",
            prompts=["ka"],
        )
        with pytest.raises(SessionValidationError):
            await service.create(request)

    @pytest.mark.asyncio
    async def test_get_session(
        self, service: RecordingSessionService
    ) -> None:
        """Test getting a session."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        created = await service.create(request)
        retrieved = await service.get(created.id)
        assert retrieved.id == created.id

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(
        self, service: RecordingSessionService
    ) -> None:
        """Test getting a nonexistent session raises error."""
        with pytest.raises(SessionNotFoundError):
            await service.get(uuid4())

    @pytest.mark.asyncio
    async def test_start_recording(
        self, service: RecordingSessionService
    ) -> None:
        """Test starting a recording session."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)
        assert session.status == SessionStatus.PENDING

        started = await service.start_recording(session.id)
        assert started.status == SessionStatus.RECORDING

    @pytest.mark.asyncio
    async def test_upload_segment(
        self, service: RecordingSessionService
    ) -> None:
        """Test uploading a segment."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa"],
        )
        session = await service.create(request)

        # Create minimal valid WAV
        wav_data = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32

        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text="ka",
            duration_ms=1000.0,
        )
        segment = await service.upload_segment(session.id, segment_info, wav_data)

        assert segment.prompt_index == 0
        assert segment.prompt_text == "ka"
        assert segment.is_accepted is True

        # Session should be in recording state
        updated = await service.get(session.id)
        assert updated.status == SessionStatus.RECORDING
        assert len(updated.segments) == 1

    @pytest.mark.asyncio
    async def test_upload_segment_invalid_wav(
        self, service: RecordingSessionService
    ) -> None:
        """Test uploading invalid audio data."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)

        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text="ka",
            duration_ms=1000.0,
        )

        with pytest.raises(SessionValidationError, match="Invalid audio"):
            await service.upload_segment(session.id, segment_info, b"not a wav")

    @pytest.mark.asyncio
    async def test_reject_segment(
        self, service: RecordingSessionService
    ) -> None:
        """Test rejecting a segment."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)

        # Upload a segment
        wav_data = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32
        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text="ka",
            duration_ms=1000.0,
        )
        segment = await service.upload_segment(session.id, segment_info, wav_data)

        # Reject it
        rejected = await service.reject_segment(
            session.id, segment.id, "Poor quality"
        )
        assert rejected.is_accepted is False
        assert rejected.rejection_reason == "Poor quality"

    @pytest.mark.asyncio
    async def test_complete_session(
        self, service: RecordingSessionService
    ) -> None:
        """Test completing a session."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)
        completed = await service.complete_session(session.id)
        assert completed.status == SessionStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_cancel_session(
        self, service: RecordingSessionService
    ) -> None:
        """Test cancelling a session."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)
        cancelled = await service.cancel_session(session.id)
        assert cancelled.status == SessionStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_complete_cancelled_session_fails(
        self, service: RecordingSessionService
    ) -> None:
        """Test that completing a cancelled session fails."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka"],
        )
        session = await service.create(request)
        await service.cancel_session(session.id)

        with pytest.raises(SessionStateError):
            await service.complete_session(session.id)

    @pytest.mark.asyncio
    async def test_get_progress(
        self, service: RecordingSessionService
    ) -> None:
        """Test getting session progress."""
        request = RecordingSessionCreate(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa", "ta", "na"],
        )
        session = await service.create(request)

        progress = await service.get_progress(session.id)
        assert progress.total_prompts == 4
        assert progress.completed_segments == 0
        assert progress.progress_percent == 0.0
        assert progress.current_prompt_text == "ka"

        # Upload one segment
        wav_data = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32
        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text="ka",
            duration_ms=1000.0,
        )
        await service.upload_segment(session.id, segment_info, wav_data)

        progress = await service.get_progress(session.id)
        assert progress.completed_segments == 1
        assert progress.progress_percent == 25.0
        assert progress.current_prompt_index == 1
        assert progress.current_prompt_text == "sa"
