"""Tests for the OtoSuggester ML-based oto parameter suggestion."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
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


class TestBatchSuggestOto:
    """Tests for the batch_suggest_oto method."""

    @pytest.fixture
    def mock_detector(self) -> MagicMock:
        """Create mock phoneme detector."""
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def mock_sofa_aligner(self) -> MagicMock:
        """Create mock SOFA aligner."""
        from src.backend.ml.forced_aligner import AlignmentResult

        aligner = MagicMock()
        aligner.batch_align = AsyncMock()
        aligner.align = AsyncMock()
        return aligner

    @pytest.fixture
    def suggester_with_sofa(
        self, mock_detector: MagicMock, mock_sofa_aligner: MagicMock
    ) -> OtoSuggester:
        """Create suggester with SOFA enabled and mocked."""
        suggester = OtoSuggester(mock_detector, use_forced_alignment=True, use_sofa=True)
        suggester._sofa_aligner = mock_sofa_aligner
        return suggester

    @pytest.fixture
    def suggester_no_sofa(self, mock_detector: MagicMock) -> OtoSuggester:
        """Create suggester with SOFA disabled."""
        return OtoSuggester(mock_detector, use_forced_alignment=False, use_sofa=False)

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_empty_list(
        self, suggester_no_sofa: OtoSuggester
    ) -> None:
        """Empty input returns empty list without any processing."""
        result = await suggester_no_sofa.batch_suggest_oto([])
        assert result == []

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_with_sofa(
        self, suggester_with_sofa: OtoSuggester, mock_sofa_aligner: MagicMock
    ) -> None:
        """Uses batch_align when SOFA is enabled and available."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]

        # Mock SOFA batch_align result
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=[
                    PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0),
                    PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=1.0),
                ],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[1]: AlignmentResult(
                segments=[
                    PhonemeSegment(phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0),
                    PhonemeSegment(phoneme="a", start_ms=70.0, end_ms=210.0, confidence=1.0),
                ],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True), \
             patch(
                 "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                 side_effect=lambda f: f.replace("_", "").replace(".wav", "").replace("", " ").strip()
             ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify batch_align was called
        mock_sofa_aligner.batch_align.assert_called_once()

        # Verify results
        assert len(result) == 2
        assert result[0].filename == "_ka.wav"
        assert result[1].filename == "_sa.wav"

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_fallback_to_sequential(
        self, suggester_with_sofa: OtoSuggester, mock_detector: MagicMock
    ) -> None:
        """Falls back to sequential processing when SOFA is unavailable."""
        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]

        # Mock phoneme detection for sequential fallback
        mock_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[
                PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9),
                PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85),
            ],
            audio_duration_ms=250.0,
            model_name="test-model",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify sequential processing was used (detector called for each file)
        assert mock_detector.detect_phonemes.call_count == 2

        # Verify results
        assert len(result) == 2
        assert result[0].filename == "_ka.wav"
        assert result[1].filename == "_sa.wav"

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_preserves_order(
        self, suggester_with_sofa: OtoSuggester, mock_sofa_aligner: MagicMock
    ) -> None:
        """Results are in same order as input paths."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ta.wav"),
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]

        # Mock SOFA batch_align result (intentionally different order)
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[1]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[0]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="t", start_ms=15.0, end_ms=55.0, confidence=1.0)],
                audio_duration_ms=240.0,
                method="sofa",
            ),
            audio_paths[2]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0)],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True), \
             patch(
                 "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                 side_effect=lambda f: f.replace("_", "").replace(".wav", "")
             ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify order matches input
        assert len(result) == 3
        assert result[0].filename == "_ta.wav"
        assert result[1].filename == "_ka.wav"
        assert result[2].filename == "_sa.wav"

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_with_custom_aliases(
        self, suggester_with_sofa: OtoSuggester, mock_sofa_aligner: MagicMock
    ) -> None:
        """Custom aliases are used when provided."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]
        custom_aliases = ["custom ka", "custom sa"]

        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[1]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0)],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True), \
             patch(
                 "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                 side_effect=lambda f: f.replace("_", "").replace(".wav", "")
             ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, aliases=custom_aliases, sofa_language="ja"
            )

        # Verify custom aliases are used
        assert result[0].alias == "custom ka"
        assert result[1].alias == "custom sa"

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_aliases_length_mismatch_raises(
        self, suggester_no_sofa: OtoSuggester
    ) -> None:
        """Raises ValueError if aliases length doesn't match paths length."""
        audio_paths = [Path("/test/_ka.wav"), Path("/test/_sa.wav")]
        aliases = ["only one alias"]  # Mismatch!

        with pytest.raises(ValueError, match="aliases length"):
            await suggester_no_sofa.batch_suggest_oto(audio_paths, aliases=aliases)

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_partial_sofa_failure(
        self,
        suggester_with_sofa: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_detector: MagicMock,
    ) -> None:
        """Files that fail SOFA are processed individually via fallback."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),  # This one will fail SOFA
        ]

        # Mock SOFA batch_align returns only first file (second failed)
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            # audio_paths[1] is missing - simulates failure
        }

        # Mock suggest_oto for fallback (called for failed files)
        fallback_suggestion = OtoSuggestion(
            filename="_sa.wav",
            alias="- sa",
            offset=20.0,
            consonant=100.0,
            cutoff=-30.0,
            preutterance=60.0,
            overlap=25.0,
            confidence=0.8,
            phonemes_detected=[],
            audio_duration_ms=260.0,
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True), \
             patch(
                 "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                 side_effect=lambda f: f.replace("_", "").replace(".wav", "")
             ), \
             patch.object(
                 suggester_with_sofa, "suggest_oto", new_callable=AsyncMock,
                 return_value=fallback_suggestion
             ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify both files have results
        assert len(result) == 2
        assert result[0].filename == "_ka.wav"
        assert result[1].filename == "_sa.wav"

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_sofa_batch_error_falls_back(
        self,
        suggester_with_sofa: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_detector: MagicMock,
    ) -> None:
        """When SOFA batch_align raises error, falls back to sequential."""
        from src.backend.ml.forced_aligner import AlignmentError

        audio_paths = [Path("/test/_ka.wav")]

        # Mock SOFA batch_align to raise error
        mock_sofa_aligner.batch_align.side_effect = AlignmentError("SOFA failed")

        # Create a mock suggestion for the fallback
        fallback_suggestion = OtoSuggestion(
            filename="_ka.wav",
            alias="- ka",
            offset=20.0,
            consonant=100.0,
            cutoff=-30.0,
            preutterance=60.0,
            overlap=25.0,
            confidence=0.85,
            phonemes_detected=[],
            audio_duration_ms=250.0,
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True), \
             patch(
                 "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                 side_effect=lambda f: f.replace("_", "").replace(".wav", "")
             ), \
             patch.object(
                 suggester_with_sofa,
                 "_batch_suggest_sequential",
                 new_callable=AsyncMock,
                 return_value=[fallback_suggestion]
             ) as mock_sequential:
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify _batch_suggest_sequential was called as fallback
        mock_sequential.assert_called_once()
        assert len(result) == 1
        assert result[0].filename == "_ka.wav"
