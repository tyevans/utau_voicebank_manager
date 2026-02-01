"""Tests for paragraph segmentation service."""

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest
import soundfile as sf

from src.backend.domain.paragraph_prompt import ParagraphPrompt, Word
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    SessionStatus,
)
from src.backend.ml.forced_aligner import AlignmentError, AlignmentResult
from src.backend.services.paragraph_segmentation_service import (
    DEFAULT_PADDING_MS,
    ExtractedSample,
    ParagraphSegmentationResult,
    ParagraphSegmentationService,
    SegmentationError,
    fuzzy_phoneme_match,
    ipa_to_romaji,
    levenshtein_distance,
)


class TestPhonemeMapping:
    """Tests for phoneme mapping utilities."""

    def test_ipa_to_romaji_direct_match(self) -> None:
        """Test direct IPA to romaji conversion."""
        assert ipa_to_romaji("ka") == "ka"
        assert ipa_to_romaji("a") == "a"
        assert ipa_to_romaji("n") == "n"

    def test_ipa_to_romaji_with_length_marker(self) -> None:
        """Test IPA with length markers."""
        assert ipa_to_romaji("a:") == "aa"
        assert ipa_to_romaji("i:") == "ii"

    def test_ipa_to_romaji_palatalized(self) -> None:
        """Test palatalized consonants."""
        assert ipa_to_romaji("kj") == "ky"
        assert ipa_to_romaji("sj") == "sh"

    def test_ipa_to_romaji_unknown(self) -> None:
        """Test unknown IPA returns lowercase original."""
        assert ipa_to_romaji("XYZ") == "xyz"

    def test_levenshtein_distance_identical(self) -> None:
        """Test Levenshtein distance for identical strings."""
        assert levenshtein_distance("hello", "hello") == 0

    def test_levenshtein_distance_one_edit(self) -> None:
        """Test Levenshtein distance for one edit."""
        assert levenshtein_distance("hello", "hallo") == 1
        assert levenshtein_distance("cat", "cats") == 1

    def test_levenshtein_distance_empty(self) -> None:
        """Test Levenshtein distance with empty string."""
        assert levenshtein_distance("hello", "") == 5
        assert levenshtein_distance("", "world") == 5

    def test_fuzzy_phoneme_match_exact(self) -> None:
        """Test fuzzy match with exact phonemes."""
        assert fuzzy_phoneme_match("ka", "ka") is True
        assert fuzzy_phoneme_match("KA", "ka") is True

    def test_fuzzy_phoneme_match_with_ipa_conversion(self) -> None:
        """Test fuzzy match with IPA to romaji conversion."""
        assert fuzzy_phoneme_match("kj", "ky") is True

    def test_fuzzy_phoneme_match_within_threshold(self) -> None:
        """Test fuzzy match within edit distance threshold."""
        assert fuzzy_phoneme_match("ka", "ko", threshold=2) is True
        assert fuzzy_phoneme_match("ka", "xyz", threshold=2) is False


class TestExtractedSampleModel:
    """Tests for ExtractedSample Pydantic model."""

    def test_create_extracted_sample(self, tmp_path: Path) -> None:
        """Test creating an ExtractedSample."""
        output_path = tmp_path / "test.wav"
        output_path.touch()

        sample = ExtractedSample(
            phoneme="ka",
            source_word="akai",
            start_ms=100.0,
            end_ms=200.0,
            output_path=output_path,
            duration_ms=100.0,
            confidence=0.95,
        )

        assert sample.phoneme == "ka"
        assert sample.source_word == "akai"
        assert sample.start_ms == 100.0
        assert sample.end_ms == 200.0
        assert sample.duration_ms == 100.0
        assert sample.confidence == 0.95


class TestParagraphSegmentationResultModel:
    """Tests for ParagraphSegmentationResult Pydantic model."""

    def test_create_successful_result(self, tmp_path: Path) -> None:
        """Test creating a successful segmentation result."""
        result = ParagraphSegmentationResult(
            paragraph_id="test-para-001",
            audio_path=tmp_path / "audio.wav",
            alignment={"segments": [], "method": "mfa"},
            extracted_samples=[],
            coverage_achieved=["a", "ka", "i"],
            coverage_missing=["sa"],
            success=True,
            errors=[],
        )

        assert result.paragraph_id == "test-para-001"
        assert result.success is True
        assert len(result.coverage_achieved) == 3
        assert len(result.coverage_missing) == 1

    def test_create_failed_result(self, tmp_path: Path) -> None:
        """Test creating a failed segmentation result."""
        result = ParagraphSegmentationResult(
            paragraph_id="test-para-001",
            audio_path=tmp_path / "audio.wav",
            alignment={},
            success=False,
            errors=["Alignment failed: MFA not available"],
        )

        assert result.success is False
        assert len(result.errors) == 1


class TestParagraphSegmentationService:
    """Tests for ParagraphSegmentationService."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def sample_audio(self, temp_dir: Path) -> Path:
        """Create a sample audio file for testing."""
        audio_path = temp_dir / "test_audio.wav"
        # Generate 2 seconds of silence at 44100 Hz
        sample_rate = 44100
        duration = 2.0
        audio = np.zeros(int(sample_rate * duration), dtype=np.float32)
        sf.write(str(audio_path), audio, sample_rate)
        return audio_path

    @pytest.fixture
    def sample_paragraph(self) -> ParagraphPrompt:
        """Create a sample paragraph prompt."""
        return ParagraphPrompt(
            id="test-para-001",
            text="akai",
            romaji="akai",
            words=[
                Word(
                    text="akai",
                    romaji="akai",
                    phonemes=["a", "ka", "i"],
                    start_char=0,
                )
            ],
            expected_phonemes=["a", "ka", "i"],
            style="cv",
            language="ja",
            category="test",
        )

    @pytest.fixture
    def mock_alignment_result(self) -> AlignmentResult:
        """Create a mock alignment result."""
        segments = [
            PhonemeSegment(phoneme="a", start_ms=0, end_ms=200, confidence=0.95),
            PhonemeSegment(phoneme="ka", start_ms=200, end_ms=450, confidence=0.90),
            PhonemeSegment(phoneme="i", start_ms=450, end_ms=600, confidence=0.92),
        ]
        word_segments = [
            {"word": "akai", "start_ms": 0, "end_ms": 600},
        ]
        return AlignmentResult(
            segments=segments,
            audio_duration_ms=2000.0,
            method="mfa",
            word_segments=word_segments,
        )

    @pytest.fixture
    def service(self) -> ParagraphSegmentationService:
        """Create a service instance."""
        return ParagraphSegmentationService(prefer_mfa=True)

    @pytest.mark.asyncio
    async def test_segment_paragraph_success(
        self,
        service: ParagraphSegmentationService,
        sample_audio: Path,
        sample_paragraph: ParagraphPrompt,
        mock_alignment_result: AlignmentResult,
        temp_dir: Path,
    ) -> None:
        """Test successful paragraph segmentation."""
        output_dir = temp_dir / "output"

        with patch(
            "src.backend.services.paragraph_segmentation_service.get_forced_aligner"
        ) as mock_get_aligner:
            mock_aligner = AsyncMock()
            mock_aligner.align.return_value = mock_alignment_result
            mock_get_aligner.return_value = mock_aligner

            result = await service.segment_paragraph(
                audio_path=sample_audio,
                paragraph=sample_paragraph,
                output_dir=output_dir,
            )

        assert result.success is True
        assert result.paragraph_id == "test-para-001"
        assert len(result.extracted_samples) == 3
        assert "a" in result.coverage_achieved
        assert "ka" in result.coverage_achieved
        assert "i" in result.coverage_achieved
        assert len(result.coverage_missing) == 0

    @pytest.mark.asyncio
    async def test_segment_paragraph_alignment_failure(
        self,
        service: ParagraphSegmentationService,
        sample_audio: Path,
        sample_paragraph: ParagraphPrompt,
        temp_dir: Path,
    ) -> None:
        """Test segmentation when alignment fails."""
        output_dir = temp_dir / "output"

        with patch(
            "src.backend.services.paragraph_segmentation_service.get_forced_aligner"
        ) as mock_get_aligner:
            mock_aligner = AsyncMock()
            mock_aligner.align.side_effect = AlignmentError("MFA not available")
            mock_get_aligner.return_value = mock_aligner

            result = await service.segment_paragraph(
                audio_path=sample_audio,
                paragraph=sample_paragraph,
                output_dir=output_dir,
            )

        assert result.success is False
        assert len(result.errors) == 1
        assert "Alignment failed" in result.errors[0]
        assert result.coverage_missing == sample_paragraph.expected_phonemes

    @pytest.mark.asyncio
    async def test_extracted_samples_have_correct_output_paths(
        self,
        service: ParagraphSegmentationService,
        sample_audio: Path,
        sample_paragraph: ParagraphPrompt,
        mock_alignment_result: AlignmentResult,
        temp_dir: Path,
    ) -> None:
        """Test that extracted samples have correct output paths."""
        output_dir = temp_dir / "output"

        with patch(
            "src.backend.services.paragraph_segmentation_service.get_forced_aligner"
        ) as mock_get_aligner:
            mock_aligner = AsyncMock()
            mock_aligner.align.return_value = mock_alignment_result
            mock_get_aligner.return_value = mock_aligner

            result = await service.segment_paragraph(
                audio_path=sample_audio,
                paragraph=sample_paragraph,
                output_dir=output_dir,
            )

        for sample in result.extracted_samples:
            assert sample.output_path.exists()
            assert sample.output_path.suffix == ".wav"
            assert output_dir in sample.output_path.parents or sample.output_path.parent == output_dir

    @pytest.mark.asyncio
    async def test_extracted_audio_is_valid_wav(
        self,
        service: ParagraphSegmentationService,
        sample_audio: Path,
        sample_paragraph: ParagraphPrompt,
        mock_alignment_result: AlignmentResult,
        temp_dir: Path,
    ) -> None:
        """Test that extracted audio files are valid WAV files."""
        output_dir = temp_dir / "output"

        with patch(
            "src.backend.services.paragraph_segmentation_service.get_forced_aligner"
        ) as mock_get_aligner:
            mock_aligner = AsyncMock()
            mock_aligner.align.return_value = mock_alignment_result
            mock_get_aligner.return_value = mock_aligner

            result = await service.segment_paragraph(
                audio_path=sample_audio,
                paragraph=sample_paragraph,
                output_dir=output_dir,
            )

        for sample in result.extracted_samples:
            # Verify we can read the WAV file
            audio, sr = sf.read(str(sample.output_path))
            assert sr == 44100  # UTAU standard sample rate
            assert len(audio) > 0

    @pytest.mark.asyncio
    async def test_coverage_tracking(
        self,
        service: ParagraphSegmentationService,
        sample_audio: Path,
        temp_dir: Path,
    ) -> None:
        """Test that coverage tracking correctly identifies missing phonemes."""
        # Paragraph expects 4 phonemes, but alignment only has 2
        paragraph = ParagraphPrompt(
            id="test-para-002",
            text="akai",
            romaji="akai",
            words=[
                Word(
                    text="akai",
                    romaji="akai",
                    phonemes=["a", "ka", "i", "extra"],  # 4 expected
                    start_char=0,
                )
            ],
            expected_phonemes=["a", "ka", "i", "extra"],
            style="cv",
            language="ja",
            category="test",
        )

        # Alignment only returns 2 phonemes
        alignment = AlignmentResult(
            segments=[
                PhonemeSegment(phoneme="a", start_ms=0, end_ms=200, confidence=0.95),
                PhonemeSegment(phoneme="ka", start_ms=200, end_ms=450, confidence=0.90),
            ],
            audio_duration_ms=2000.0,
            method="mfa",
            word_segments=[{"word": "akai", "start_ms": 0, "end_ms": 450}],
        )

        output_dir = temp_dir / "output"

        with patch(
            "src.backend.services.paragraph_segmentation_service.get_forced_aligner"
        ) as mock_get_aligner:
            mock_aligner = AsyncMock()
            mock_aligner.align.return_value = alignment
            mock_get_aligner.return_value = mock_aligner

            result = await service.segment_paragraph(
                audio_path=sample_audio,
                paragraph=paragraph,
                output_dir=output_dir,
            )

        # Should have achieved a and ka, missing i and extra
        assert "a" in result.coverage_achieved
        assert "ka" in result.coverage_achieved
        # The missing phonemes depend on mapping logic
        assert len(result.coverage_missing) > 0


class TestParagraphSegmentationServiceSession:
    """Tests for session-based segmentation."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def mock_session_service(self, temp_dir: Path) -> MagicMock:
        """Create a mock session service."""
        service = MagicMock()

        # Create a sample session
        session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            recording_mode="paragraph",
            status=SessionStatus.COMPLETED,
            prompts=["akai hana ga saku"],
            paragraph_ids=["test-para-001"],
            segments=[
                RecordingSegment(
                    prompt_index=0,
                    prompt_text="akai hana ga saku",
                    audio_filename="0000_akai.wav",
                    duration_ms=2000.0,
                    is_accepted=True,
                )
            ],
        )

        # Configure mock
        service.get = AsyncMock(return_value=session)
        audio_path = temp_dir / "audio.wav"
        # Create dummy audio
        sf.write(str(audio_path), np.zeros(44100, dtype=np.float32), 44100)
        service.get_segment_audio_path = AsyncMock(return_value=audio_path)

        return service

    @pytest.mark.asyncio
    async def test_segment_session_requires_session_service(
        self,
        temp_dir: Path,
    ) -> None:
        """Test that segment_session requires session service."""
        service = ParagraphSegmentationService(session_service=None)

        with pytest.raises(SegmentationError, match="Session service required"):
            await service.segment_session(
                session_id=uuid4(),
                output_dir=temp_dir / "output",
            )

    @pytest.mark.asyncio
    async def test_segment_session_rejects_non_paragraph_mode(
        self,
        mock_session_service: MagicMock,
        temp_dir: Path,
    ) -> None:
        """Test that segment_session rejects non-paragraph mode sessions."""
        # Modify mock to return individual mode session
        individual_session = RecordingSession(
            voicebank_id="test_vb",
            recording_style="cv",
            language="ja",
            recording_mode="individual",  # Not paragraph
            status=SessionStatus.COMPLETED,
            prompts=["ka", "sa", "ta"],
        )
        mock_session_service.get = AsyncMock(return_value=individual_session)

        service = ParagraphSegmentationService(
            session_service=mock_session_service,
        )

        with pytest.raises(SegmentationError, match="not in paragraph mode"):
            await service.segment_session(
                session_id=uuid4(),
                output_dir=temp_dir / "output",
            )


class TestBasicPhonemeExtraction:
    """Tests for basic phoneme extraction utility."""

    @pytest.fixture
    def service(self) -> ParagraphSegmentationService:
        """Create a service instance."""
        return ParagraphSegmentationService()

    def test_extract_cv_phonemes(
        self, service: ParagraphSegmentationService
    ) -> None:
        """Test extracting CV phonemes from romaji."""
        phonemes = service._extract_basic_phonemes("akai")
        assert "a" in phonemes
        assert "ka" in phonemes
        assert "i" in phonemes

    def test_extract_with_n(
        self, service: ParagraphSegmentationService
    ) -> None:
        """Test extracting phonemes with syllabic n."""
        phonemes = service._extract_basic_phonemes("kantan")
        assert "n" in phonemes  # Syllabic n
        assert "ka" in phonemes
        assert "ta" in phonemes

    def test_extract_with_special_consonants(
        self, service: ParagraphSegmentationService
    ) -> None:
        """Test extracting phonemes with special consonants."""
        phonemes = service._extract_basic_phonemes("shinya")
        assert "shi" in phonemes or "sh" in phonemes
        assert "nya" in phonemes or "ny" in phonemes

    def test_extract_simple_word(
        self, service: ParagraphSegmentationService
    ) -> None:
        """Test extracting phonemes from a simple word."""
        phonemes = service._extract_basic_phonemes("saku")
        assert "sa" in phonemes
        assert "ku" in phonemes


class TestPaddingConfiguration:
    """Tests for padding configuration."""

    def test_default_padding(self) -> None:
        """Test default padding value."""
        service = ParagraphSegmentationService()
        assert service._padding_ms == DEFAULT_PADDING_MS

    def test_custom_padding(self) -> None:
        """Test custom padding configuration."""
        service = ParagraphSegmentationService(padding_ms=25.0)
        assert service._padding_ms == 25.0
