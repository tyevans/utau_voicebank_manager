"""Tests for voicebank generation pipeline."""

import struct
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import numpy as np
import pytest

from src.backend.domain.generated_voicebank import (
    GeneratedVoicebank,
    GenerateVoicebankRequest,
    SlicedSample,
)
from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
)
from src.backend.services.alignment_service import (
    SegmentAlignment,
    SessionAlignmentResult,
)
from src.backend.services.voicebank_generator import (
    NoAlignedSegmentsError,
    VoicebankGenerator,
)


def create_wav_bytes(duration_ms: float = 500, sample_rate: int = 44100) -> bytes:
    """Create a valid WAV file with silence.

    Args:
        duration_ms: Duration in milliseconds
        sample_rate: Sample rate in Hz

    Returns:
        WAV file bytes
    """
    num_samples = int(sample_rate * duration_ms / 1000)
    audio_data = np.zeros(num_samples, dtype=np.int16)

    # WAV header
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(audio_data) * 2,  # File size - 8
        b"WAVE",
        b"fmt ",
        16,  # Subchunk1 size
        1,  # Audio format (PCM)
        1,  # Num channels
        sample_rate,  # Sample rate
        sample_rate * 2,  # Byte rate
        2,  # Block align
        16,  # Bits per sample
        b"data",
        len(audio_data) * 2,  # Data size
    )

    return header + audio_data.tobytes()


class TestGeneratedVoicebankModels:
    """Tests for GeneratedVoicebank Pydantic models."""

    def test_generate_request_model(self) -> None:
        """Test GenerateVoicebankRequest creation."""
        request = GenerateVoicebankRequest(
            voicebank_name="Test Voicebank",
            include_character_txt=True,
            encoding="utf-8",
        )
        assert request.voicebank_name == "Test Voicebank"
        assert request.output_path is None
        assert request.include_character_txt is True
        assert request.encoding == "utf-8"

    def test_generate_request_with_path(self) -> None:
        """Test GenerateVoicebankRequest with custom output path."""
        request = GenerateVoicebankRequest(
            voicebank_name="Test VB",
            output_path="/custom/path",
        )
        assert request.output_path == "/custom/path"

    def test_generated_voicebank_model(self) -> None:
        """Test GeneratedVoicebank creation."""
        result = GeneratedVoicebank(
            name="Test Voicebank",
            path=Path("/output/test_voicebank"),
            sample_count=10,
            oto_entries=10,
            recording_style="cv",
            language="ja",
            generation_time_seconds=5.5,
            warnings=["Sample skipped: bad_file.wav"],
            skipped_segments=1,
            average_confidence=0.85,
        )
        assert result.name == "Test Voicebank"
        assert result.sample_count == 10
        assert result.oto_entries == 10
        assert result.recording_style == "cv"
        assert result.language == "ja"
        assert result.generation_time_seconds == 5.5
        assert len(result.warnings) == 1
        assert result.skipped_segments == 1
        assert result.average_confidence == 0.85

    def test_sliced_sample_model(self) -> None:
        """Test SlicedSample creation."""
        sample = SlicedSample(
            filename="_ka.wav",
            alias="- ka",
            source_segment_id="abc-123",
            phoneme="ka",
            start_ms=0,
            end_ms=500,
            duration_ms=500,
        )
        assert sample.filename == "_ka.wav"
        assert sample.alias == "- ka"
        assert sample.phoneme == "ka"
        assert sample.duration_ms == 500


class TestVoicebankGenerator:
    """Tests for VoicebankGenerator service."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def mock_session_service(self):
        """Create a mock session service."""
        service = MagicMock()
        service.get = AsyncMock()
        service.get_segment_audio_path = AsyncMock()
        return service

    @pytest.fixture
    def mock_alignment_service(self):
        """Create a mock alignment service."""
        service = MagicMock()
        service.align_session = AsyncMock()
        return service

    @pytest.fixture
    def mock_oto_suggester(self):
        """Create a mock oto suggester."""
        suggester = MagicMock()
        suggester.suggest_oto = AsyncMock()
        return suggester

    @pytest.fixture
    def generator(
        self,
        temp_dir: Path,
        mock_session_service,
        mock_alignment_service,
        mock_oto_suggester,
    ) -> VoicebankGenerator:
        """Create a VoicebankGenerator instance."""
        return VoicebankGenerator(
            session_service=mock_session_service,
            alignment_service=mock_alignment_service,
            oto_suggester=mock_oto_suggester,
            output_base_path=temp_dir / "output",
        )

    @pytest.mark.asyncio
    async def test_generate_raises_for_nonexistent_session(
        self,
        generator: VoicebankGenerator,
        mock_session_service,
    ) -> None:
        """Test that generation fails for nonexistent session."""
        from src.backend.services.recording_session_service import SessionNotFoundError

        mock_session_service.get.side_effect = SessionNotFoundError("Not found")

        with pytest.raises(SessionNotFoundError):
            await generator.generate_from_session(
                session_id=uuid4(),
                voicebank_name="Test VB",
            )

    @pytest.mark.asyncio
    async def test_generate_raises_for_no_aligned_segments(
        self,
        generator: VoicebankGenerator,
        mock_session_service,
        mock_alignment_service,
    ) -> None:
        """Test that generation fails when no segments can be aligned."""
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa"],
            segments=[],
        )
        mock_session_service.get.return_value = session

        # No aligned segments
        mock_alignment_service.align_session.return_value = SessionAlignmentResult(
            session_id=session.id,
            voicebank_id="test_vb",
            language="ja",
            total_segments=0,
            aligned_segments=0,
            failed_segments=0,
            segments=[],
        )

        with pytest.raises(NoAlignedSegmentsError):
            await generator.generate_from_session(
                session_id=session.id,
                voicebank_name="Test VB",
            )

    @pytest.mark.asyncio
    async def test_sanitize_name(self, generator: VoicebankGenerator) -> None:
        """Test filename sanitization."""
        assert generator._sanitize_name("ka") == "ka"
        assert generator._sanitize_name("a ka") == "a_ka"
        assert generator._sanitize_name("test/path") == "test_path"
        assert generator._sanitize_name("file:name") == "file_name"
        assert generator._sanitize_name("") == "sample"
        assert generator._sanitize_name("___") == "sample"

    @pytest.mark.asyncio
    async def test_get_unique_filename(
        self, generator: VoicebankGenerator, temp_dir: Path
    ) -> None:
        """Test unique filename generation."""
        output_dir = temp_dir / "test_output"
        output_dir.mkdir()

        # First call should return unchanged
        name = generator._get_unique_filename(output_dir, "_ka.wav")
        assert name == "_ka.wav"

        # Create the file
        (output_dir / "_ka.wav").touch()

        # Now should get suffix
        name = generator._get_unique_filename(output_dir, "_ka.wav")
        assert name == "_ka_1.wav"

        # Create that too
        (output_dir / "_ka_1.wav").touch()

        name = generator._get_unique_filename(output_dir, "_ka.wav")
        assert name == "_ka_2.wav"

    def test_apply_fade(self, generator: VoicebankGenerator) -> None:
        """Test fade application to audio."""
        # Create test audio
        audio = np.ones(4410, dtype=np.float32)  # 100ms at 44100Hz
        sample_rate = 44100

        result = generator._apply_fade(audio, sample_rate)

        # Should fade in at start
        assert result[0] < 0.1
        # Should fade out at end
        assert result[-1] < 0.1
        # Middle should be unchanged
        assert result[len(result) // 2] == 1.0

    def test_normalize_audio_mono_int16(self, generator: VoicebankGenerator) -> None:
        """Test audio normalization from int16."""
        audio = np.array([16384, -16384, 0], dtype=np.int16)
        result = generator._normalize_audio(audio, 44100)

        assert result.dtype == np.float32
        assert len(result.shape) == 1  # Mono
        assert np.max(np.abs(result)) <= 1.0

    def test_normalize_audio_stereo(self, generator: VoicebankGenerator) -> None:
        """Test audio normalization from stereo."""
        # Stereo audio
        audio = np.array([[16384, -16384], [16384, -16384]], dtype=np.int16)
        result = generator._normalize_audio(audio, 44100)

        assert len(result.shape) == 1  # Converted to mono

    def test_slice_audio(self, generator: VoicebankGenerator) -> None:
        """Test audio slicing."""
        # 1 second of audio at 44100Hz
        audio = np.arange(44100, dtype=np.float32)
        sample_rate = 44100

        # Slice 100ms to 200ms
        result = generator._slice_audio(audio, sample_rate, 100, 200)

        assert result is not None
        # Should be ~4410 samples (100ms)
        assert len(result) == 4410
        # First sample should be from position 100ms
        assert result[0] == audio[4410]

    def test_slice_audio_invalid_bounds(self, generator: VoicebankGenerator) -> None:
        """Test slicing with invalid bounds returns None."""
        audio = np.zeros(44100, dtype=np.float32)

        result = generator._slice_audio(audio, 44100, 500, 100)  # end < start
        assert result is None

    def test_write_character_txt(
        self, generator: VoicebankGenerator, temp_dir: Path
    ) -> None:
        """Test character.txt generation."""
        output_dir = temp_dir / "test_vb"
        output_dir.mkdir()

        generator._write_character_txt(
            output_path=output_dir,
            name="Test Voicebank",
            language="ja",
            recording_style="cv",
        )

        char_file = output_dir / "character.txt"
        assert char_file.exists()

        content = char_file.read_text()
        assert "name=Test Voicebank" in content
        assert "language=ja" in content
        assert "recording_style=cv" in content


class TestVoicebankGeneratorIntegration:
    """Integration tests for VoicebankGenerator with mocked dependencies."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def audio_file(self, temp_dir: Path) -> Path:
        """Create a test audio file."""
        audio_path = temp_dir / "test_segment.wav"
        wav_bytes = create_wav_bytes(duration_ms=500)
        audio_path.write_bytes(wav_bytes)
        return audio_path

    @pytest.mark.asyncio
    async def test_generate_cv_voicebank(
        self, temp_dir: Path, audio_file: Path
    ) -> None:
        """Test generating a CV-style voicebank."""
        session_id = uuid4()
        segment_id = uuid4()

        # Create session
        session = RecordingSession(
            id=session_id,
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa"],
            segments=[
                RecordingSegment(
                    id=segment_id,
                    prompt_index=0,
                    prompt_text="ka",
                    audio_filename="0000_ka.wav",
                    duration_ms=500,
                )
            ],
        )

        # Mock session service
        mock_session_service = MagicMock()
        mock_session_service.get = AsyncMock(return_value=session)
        mock_session_service.get_segment_audio_path = AsyncMock(return_value=audio_file)

        # Create alignment result
        alignment_result = SessionAlignmentResult(
            session_id=session_id,
            voicebank_id="test_vb",
            language="ja",
            total_segments=1,
            aligned_segments=1,
            failed_segments=0,
            segments=[
                SegmentAlignment(
                    segment_id=segment_id,
                    prompt_text="ka",
                    audio_filename="0000_ka.wav",
                    phonemes=[
                        PhonemeSegment(
                            phoneme="k", start_ms=10, end_ms=50, confidence=0.9
                        ),
                        PhonemeSegment(
                            phoneme="a", start_ms=50, end_ms=200, confidence=0.95
                        ),
                    ],
                    word_segments=[],
                    audio_duration_ms=500,
                    alignment_method="wav2vec2",
                    success=True,
                )
            ],
        )

        mock_alignment_service = MagicMock()
        mock_alignment_service.align_session = AsyncMock(return_value=alignment_result)

        # Mock oto suggester
        mock_oto_suggester = MagicMock()
        mock_oto_suggester.suggest_oto = AsyncMock(
            return_value=OtoSuggestion(
                filename="_ka.wav",
                alias="- ka",
                offset=10,
                consonant=80,
                cutoff=-50,
                preutterance=40,
                overlap=15,
                confidence=0.9,
                phonemes_detected=[],
                audio_duration_ms=500,
            )
        )

        # Create generator
        output_path = temp_dir / "output"
        generator = VoicebankGenerator(
            session_service=mock_session_service,
            alignment_service=mock_alignment_service,
            oto_suggester=mock_oto_suggester,
            output_base_path=output_path,
        )

        # Generate
        result = await generator.generate_from_session(
            session_id=session_id,
            voicebank_name="Test CV Voicebank",
        )

        # Verify result
        assert result.name == "Test CV Voicebank"
        assert result.sample_count >= 1
        assert result.oto_entries >= 1
        assert result.recording_style == "cv"
        assert result.language == "ja"
        assert result.path.exists()

        # Check oto.ini was created
        oto_file = result.path / "oto.ini"
        assert oto_file.exists()
        content = oto_file.read_text()
        assert "- ka" in content

        # Check character.txt
        char_file = result.path / "character.txt"
        assert char_file.exists()

    @pytest.mark.asyncio
    async def test_generate_with_failed_segments(
        self, temp_dir: Path, audio_file: Path
    ) -> None:
        """Test generation continues when some segments fail."""
        session_id = uuid4()

        session = RecordingSession(
            id=session_id,
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            prompts=["ka", "sa"],
            segments=[
                RecordingSegment(
                    prompt_index=0,
                    prompt_text="ka",
                    audio_filename="0000_ka.wav",
                    duration_ms=500,
                ),
                RecordingSegment(
                    prompt_index=1,
                    prompt_text="sa",
                    audio_filename="0001_sa.wav",
                    duration_ms=500,
                ),
            ],
        )

        mock_session_service = MagicMock()
        mock_session_service.get = AsyncMock(return_value=session)
        mock_session_service.get_segment_audio_path = AsyncMock(return_value=audio_file)

        # One success, one failure
        alignment_result = SessionAlignmentResult(
            session_id=session_id,
            voicebank_id="test_vb",
            language="ja",
            total_segments=2,
            aligned_segments=1,
            failed_segments=1,
            segments=[
                SegmentAlignment(
                    segment_id=uuid4(),
                    prompt_text="ka",
                    audio_filename="0000_ka.wav",
                    phonemes=[
                        PhonemeSegment(
                            phoneme="k", start_ms=10, end_ms=50, confidence=0.9
                        ),
                        PhonemeSegment(
                            phoneme="a", start_ms=50, end_ms=200, confidence=0.95
                        ),
                    ],
                    word_segments=[],
                    audio_duration_ms=500,
                    alignment_method="wav2vec2",
                    success=True,
                ),
                SegmentAlignment(
                    segment_id=uuid4(),
                    prompt_text="sa",
                    audio_filename="0001_sa.wav",
                    phonemes=[],
                    word_segments=[],
                    audio_duration_ms=500,
                    alignment_method="none",
                    success=False,
                    error_message="Alignment failed",
                ),
            ],
        )

        mock_alignment_service = MagicMock()
        mock_alignment_service.align_session = AsyncMock(return_value=alignment_result)

        mock_oto_suggester = MagicMock()
        mock_oto_suggester.suggest_oto = AsyncMock(
            return_value=OtoSuggestion(
                filename="_ka.wav",
                alias="- ka",
                offset=10,
                consonant=80,
                cutoff=-50,
                preutterance=40,
                overlap=15,
                confidence=0.9,
                phonemes_detected=[],
                audio_duration_ms=500,
            )
        )

        output_path = temp_dir / "output"
        generator = VoicebankGenerator(
            session_service=mock_session_service,
            alignment_service=mock_alignment_service,
            oto_suggester=mock_oto_suggester,
            output_base_path=output_path,
        )

        result = await generator.generate_from_session(
            session_id=session_id,
            voicebank_name="Test VB",
        )

        # Should have processed the successful one
        assert result.sample_count >= 1
        assert result.skipped_segments == 1
        assert len(result.warnings) >= 1
