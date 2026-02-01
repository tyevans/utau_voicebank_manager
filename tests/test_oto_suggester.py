"""Tests for the OtoSuggester ML-based oto parameter suggestion."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path

from src.backend.domain.oto_suggestion import OtoSuggestion, OtoSuggestionRequest
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.ml.oto_suggester import (
    OtoSuggester,
    IPA_CONSONANTS,
    IPA_VOWELS,
    DEFAULT_OFFSET_MS,
    DEFAULT_PREUTTERANCE_MS,
    DEFAULT_CONSONANT_MS,
    DEFAULT_OVERLAP_MS,
    DEFAULT_CUTOFF_PADDING_MS,
)


class TestOtoSuggestionModels:
    """Test OtoSuggestion Pydantic models."""

    def test_oto_suggestion_valid(self) -> None:
        """Test creating a valid OtoSuggestion."""
        suggestion = OtoSuggestion(
            filename="_ka.wav",
            alias="- ka",
            offset=20.0,
            consonant=100.0,
            cutoff=-30.0,
            preutterance=60.0,
            overlap=25.0,
            confidence=0.85,
            phonemes_detected=[],
            audio_duration_ms=500.0,
        )

        assert suggestion.filename == "_ka.wav"
        assert suggestion.alias == "- ka"
        assert suggestion.offset == 20.0
        assert suggestion.consonant == 100.0
        assert suggestion.cutoff == -30.0
        assert suggestion.preutterance == 60.0
        assert suggestion.overlap == 25.0
        assert suggestion.confidence == 0.85
        assert suggestion.audio_duration_ms == 500.0

    def test_oto_suggestion_with_phonemes(self) -> None:
        """Test OtoSuggestion with detected phonemes."""
        phonemes = [
            PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85),
        ]
        suggestion = OtoSuggestion(
            filename="_ka.wav",
            alias="- ka",
            offset=10.0,
            consonant=80.0,
            cutoff=-30.0,
            preutterance=40.0,
            overlap=16.0,
            confidence=0.87,
            phonemes_detected=phonemes,
            audio_duration_ms=250.0,
        )

        assert len(suggestion.phonemes_detected) == 2
        assert suggestion.phonemes_detected[0].phoneme == "k"

    def test_oto_suggestion_request(self) -> None:
        """Test OtoSuggestionRequest model."""
        request = OtoSuggestionRequest(
            voicebank_id="vb123",
            filename="_ka.wav",
            alias="custom alias",
        )

        assert request.voicebank_id == "vb123"
        assert request.filename == "_ka.wav"
        assert request.alias == "custom alias"

    def test_oto_suggestion_request_optional_alias(self) -> None:
        """Test OtoSuggestionRequest with no alias."""
        request = OtoSuggestionRequest(
            voicebank_id="vb123",
            filename="_ka.wav",
        )

        assert request.alias is None


class TestPhonemeClassification:
    """Test phoneme classification functionality."""

    @pytest.fixture
    def suggester(self) -> OtoSuggester:
        """Create suggester with mock detector."""
        mock_detector = MagicMock()
        return OtoSuggester(mock_detector)

    def test_classify_consonants(self, suggester: OtoSuggester) -> None:
        """Test classification of consonant phonemes."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=0, end_ms=40, confidence=0.9),
            PhonemeSegment(phoneme="t", start_ms=100, end_ms=140, confidence=0.9),
            PhonemeSegment(phoneme="s", start_ms=200, end_ms=240, confidence=0.9),
        ]

        classification = suggester._classify_phonemes(segments)

        assert len(classification["consonants"]) == 3
        assert len(classification["vowels"]) == 0

    def test_classify_vowels(self, suggester: OtoSuggester) -> None:
        """Test classification of vowel phonemes."""
        segments = [
            PhonemeSegment(phoneme="a", start_ms=0, end_ms=100, confidence=0.9),
            PhonemeSegment(phoneme="i", start_ms=100, end_ms=200, confidence=0.9),
            PhonemeSegment(phoneme="u", start_ms=200, end_ms=300, confidence=0.9),
        ]

        classification = suggester._classify_phonemes(segments)

        assert len(classification["consonants"]) == 0
        assert len(classification["vowels"]) == 3

    def test_classify_mixed_cv(self, suggester: OtoSuggester) -> None:
        """Test classification of CV (consonant-vowel) pattern."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20, end_ms=60, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=60, end_ms=200, confidence=0.85),
        ]

        classification = suggester._classify_phonemes(segments)

        assert len(classification["consonants"]) == 1
        assert len(classification["vowels"]) == 1
        assert classification["consonants"][0].phoneme == "k"
        assert classification["vowels"][0].phoneme == "a"

    def test_classify_ipa_special_chars(self, suggester: OtoSuggester) -> None:
        """Test classification of IPA special characters."""
        segments = [
            # sh sound (esh)
            PhonemeSegment(phoneme="\u0283", start_ms=0, end_ms=50, confidence=0.9),
            # schwa
            PhonemeSegment(phoneme="\u0259", start_ms=50, end_ms=150, confidence=0.85),
        ]

        classification = suggester._classify_phonemes(segments)

        assert len(classification["consonants"]) == 1
        assert len(classification["vowels"]) == 1


class TestParameterEstimation:
    """Test oto parameter estimation methods."""

    @pytest.fixture
    def suggester(self) -> OtoSuggester:
        """Create suggester with mock detector."""
        mock_detector = MagicMock()
        return OtoSuggester(mock_detector)

    def test_estimate_offset_from_segments(self, suggester: OtoSuggester) -> None:
        """Test offset estimation finds first sound."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=30.0, end_ms=70.0, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=70.0, end_ms=200.0, confidence=0.85),
        ]

        offset = suggester._estimate_offset(segments)

        # Should be first segment start minus padding (10ms)
        assert offset == 20.0

    def test_estimate_offset_empty_segments(self, suggester: OtoSuggester) -> None:
        """Test offset estimation with no segments."""
        offset = suggester._estimate_offset([])
        assert offset == DEFAULT_OFFSET_MS

    def test_estimate_offset_low_confidence_skipped(
        self, suggester: OtoSuggester
    ) -> None:
        """Test that low confidence segments are skipped."""
        segments = [
            PhonemeSegment(phoneme="x", start_ms=10.0, end_ms=20.0, confidence=0.1),
            PhonemeSegment(phoneme="k", start_ms=30.0, end_ms=70.0, confidence=0.9),
        ]

        offset = suggester._estimate_offset(segments)

        # Should skip first low-confidence segment
        assert offset == 20.0  # 30 - 10 padding

    def test_estimate_preutterance_cv(self, suggester: OtoSuggester) -> None:
        """Test preutterance estimation for CV sample."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85),
        ]
        classification = suggester._classify_phonemes(segments)

        preutterance = suggester._estimate_preutterance(segments, classification)

        # Should be absolute position at consonant-vowel boundary: 60.0
        assert preutterance == 60.0

    def test_estimate_preutterance_empty(self, suggester: OtoSuggester) -> None:
        """Test preutterance estimation with no segments."""
        classification = {"consonants": [], "vowels": [], "unknown": []}
        preutterance = suggester._estimate_preutterance([], classification)
        assert preutterance == DEFAULT_PREUTTERANCE_MS

    def test_estimate_overlap(self, suggester: OtoSuggester) -> None:
        """Test overlap estimation as position between offset and preutterance."""
        # offset=20, preutterance=100
        overlap = suggester._estimate_overlap(20.0, 100.0)

        # Should be positioned 40% of the way from offset to preutterance
        # 20 + (100 - 20) * 0.4 = 20 + 32 = 52
        assert overlap == 52.0

    def test_estimate_overlap_position(self, suggester: OtoSuggester) -> None:
        """Test overlap is always positioned between offset and preutterance."""
        # Normal case
        overlap = suggester._estimate_overlap(10.0, 100.0)
        assert 10.0 <= overlap <= 100.0

        # Edge case: preutterance at offset
        overlap_edge = suggester._estimate_overlap(50.0, 50.0)
        assert overlap_edge == 50.0

    def test_estimate_cutoff(self, suggester: OtoSuggester) -> None:
        """Test cutoff estimation finds end of sound."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=180.0, confidence=0.85),
        ]

        cutoff = suggester._estimate_cutoff(250.0, segments)

        # Last segment ends at 180, add 20ms padding = 200
        # Cutoff = -(250 - 200) = -50
        assert cutoff == -50.0

    def test_estimate_cutoff_empty(self, suggester: OtoSuggester) -> None:
        """Test cutoff estimation with no segments."""
        cutoff = suggester._estimate_cutoff(300.0, [])
        assert cutoff == -DEFAULT_CUTOFF_PADDING_MS

    def test_estimate_consonant_end_cv(self, suggester: OtoSuggester) -> None:
        """Test consonant end estimation for CV."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9),
            PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85),
        ]
        classification = suggester._classify_phonemes(segments)

        consonant_end = suggester._estimate_consonant_end(segments, classification)

        # Consonant ends at 60, vowel is 140ms long
        # Extension = 140 * 0.3 = 42
        # Consonant end = 60 + 42 = 102
        assert consonant_end == pytest.approx(102.0, rel=0.01)


class TestAliasGeneration:
    """Test alias generation from filename."""

    @pytest.fixture
    def suggester(self) -> OtoSuggester:
        """Create suggester with mock detector."""
        mock_detector = MagicMock()
        return OtoSuggester(mock_detector)

    def test_generate_alias_simple_cv(self, suggester: OtoSuggester) -> None:
        """Test alias generation for simple CV filename."""
        alias = suggester._generate_alias_from_filename("_ka.wav")
        assert alias == "- ka"

    def test_generate_alias_no_underscore(self, suggester: OtoSuggester) -> None:
        """Test alias generation without leading underscore."""
        alias = suggester._generate_alias_from_filename("ka.wav")
        assert alias == "- ka"

    def test_generate_alias_longer_name(self, suggester: OtoSuggester) -> None:
        """Test alias generation for longer filename."""
        alias = suggester._generate_alias_from_filename("_akasa.wav")
        # Longer names don't get the "- " prefix
        assert alias == "akasa"


class TestConfidenceCalculation:
    """Test confidence score calculation."""

    @pytest.fixture
    def suggester(self) -> OtoSuggester:
        """Create suggester with mock detector."""
        mock_detector = MagicMock()
        return OtoSuggester(mock_detector)

    def test_confidence_no_segments(self, suggester: OtoSuggester) -> None:
        """Test confidence is 0 with no segments."""
        confidence = suggester._calculate_confidence([], 300.0)
        assert confidence == 0.0

    def test_confidence_high_quality(self, suggester: OtoSuggester) -> None:
        """Test confidence for high-quality detection."""
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20, end_ms=60, confidence=0.95),
            PhonemeSegment(phoneme="a", start_ms=60, end_ms=200, confidence=0.92),
        ]

        confidence = suggester._calculate_confidence(segments, 250.0)

        # High confidence, good coverage, optimal segment count
        assert confidence > 0.7

    def test_confidence_low_quality(self, suggester: OtoSuggester) -> None:
        """Test confidence for low-quality detection."""
        segments = [
            PhonemeSegment(phoneme="x", start_ms=0, end_ms=10, confidence=0.3),
        ]

        confidence = suggester._calculate_confidence(segments, 1000.0)

        # Low confidence, poor coverage, single segment
        assert confidence < 0.5


class TestSuggestOto:
    """Test the main suggest_oto method."""

    @pytest.fixture
    def mock_detector(self) -> MagicMock:
        """Create mock phoneme detector."""
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def suggester(self, mock_detector: MagicMock) -> OtoSuggester:
        """Create suggester with mock detector."""
        return OtoSuggester(mock_detector)

    @pytest.mark.asyncio
    async def test_suggest_oto_cv_sample(
        self, suggester: OtoSuggester, mock_detector: MagicMock
    ) -> None:
        """Test oto suggestion for a CV sample."""
        # Mock the detection result
        mock_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[
                PhonemeSegment(phoneme="k", start_ms=25.0, end_ms=65.0, confidence=0.9),
                PhonemeSegment(
                    phoneme="a", start_ms=65.0, end_ms=200.0, confidence=0.88
                ),
            ],
            audio_duration_ms=250.0,
            model_name="test-model",
        )

        suggestion = await suggester.suggest_oto(
            Path("/fake/path/_ka.wav"), alias="- ka"
        )

        assert suggestion.filename == "_ka.wav"
        assert suggestion.alias == "- ka"
        assert suggestion.offset > 0
        assert suggestion.preutterance > 0
        assert suggestion.consonant > suggestion.preutterance
        assert suggestion.cutoff < 0
        assert suggestion.overlap > 0
        assert suggestion.confidence > 0
        assert len(suggestion.phonemes_detected) == 2

    @pytest.mark.asyncio
    async def test_suggest_oto_auto_alias(
        self, suggester: OtoSuggester, mock_detector: MagicMock
    ) -> None:
        """Test oto suggestion with auto-generated alias."""
        mock_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[
                PhonemeSegment(phoneme="s", start_ms=20.0, end_ms=80.0, confidence=0.85),
                PhonemeSegment(
                    phoneme="a", start_ms=80.0, end_ms=180.0, confidence=0.82
                ),
            ],
            audio_duration_ms=220.0,
            model_name="test-model",
        )

        suggestion = await suggester.suggest_oto(Path("/fake/path/_sa.wav"))

        assert suggestion.alias == "- sa"

    @pytest.mark.asyncio
    async def test_suggest_oto_empty_detection(
        self, suggester: OtoSuggester, mock_detector: MagicMock
    ) -> None:
        """Test oto suggestion when no phonemes detected."""
        mock_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[],
            audio_duration_ms=300.0,
            model_name="test-model",
        )

        suggestion = await suggester.suggest_oto(Path("/fake/path/_ka.wav"))

        # Should use defaults
        assert suggestion.offset == DEFAULT_OFFSET_MS
        assert suggestion.preutterance == DEFAULT_PREUTTERANCE_MS
        assert suggestion.confidence == 0.0


class TestIPASets:
    """Test IPA phoneme sets coverage."""

    def test_consonants_contain_common_sounds(self) -> None:
        """Test that common consonants are in the set."""
        common_consonants = ["p", "b", "t", "d", "k", "g", "m", "n", "s", "z", "f", "v"]
        for c in common_consonants:
            assert c in IPA_CONSONANTS, f"Missing consonant: {c}"

    def test_vowels_contain_common_sounds(self) -> None:
        """Test that common vowels are in the set."""
        common_vowels = ["a", "e", "i", "o", "u"]
        for v in common_vowels:
            assert v in IPA_VOWELS, f"Missing vowel: {v}"

    def test_no_overlap_consonants_vowels(self) -> None:
        """Test that consonant and vowel sets don't overlap."""
        overlap = IPA_CONSONANTS & IPA_VOWELS
        assert len(overlap) == 0, f"Overlap found: {overlap}"
