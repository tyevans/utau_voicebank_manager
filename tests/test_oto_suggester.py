"""Tests for the OtoSuggester ML-based oto parameter suggestion."""

import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.domain.oto_suggestion import OtoSuggestion, OtoSuggestionRequest
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.ml.oto_suggester import (
    DEFAULT_CONSONANT_MS,
    DEFAULT_CUTOFF_PADDING_MS,
    DEFAULT_OFFSET_MS,
    DEFAULT_OVERLAP_MS,
    DEFAULT_PREUTTERANCE_MS,
    IPA_CONSONANTS,
    IPA_VOWELS,
    OtoSuggester,
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
        """Create suggester for testing internal methods."""
        return OtoSuggester()

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
        """Create suggester for testing internal methods."""
        return OtoSuggester()

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
        """Create suggester for testing internal methods."""
        return OtoSuggester()

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
        """Create suggester for testing internal methods."""
        return OtoSuggester()

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

    def test_confidence_penalizes_missing_phonemes(
        self, suggester: OtoSuggester
    ) -> None:
        """Test that missing phonemes reduce confidence significantly.

        A single long vowel covering 90% of audio should score lower than
        a proper multi-phoneme detection when expected count is known.
        """
        # Single segment covering 90% of audio - high coverage but wrong
        single_segment = [
            PhonemeSegment(phoneme="a", start_ms=10, end_ms=910, confidence=0.5),
        ]

        # Proper 3-phoneme detection (a, k, a) for "a ka"
        proper_segments = [
            PhonemeSegment(phoneme="a", start_ms=10, end_ms=200, confidence=0.5),
            PhonemeSegment(phoneme="k", start_ms=200, end_ms=260, confidence=0.5),
            PhonemeSegment(phoneme="a", start_ms=260, end_ms=700, confidence=0.5),
        ]

        # With expected_phoneme_count=3 (for "a ka"), the single segment
        # should score much lower due to phoneme count mismatch
        single_conf = suggester._calculate_confidence(
            single_segment, 1000.0, expected_phoneme_count=3
        )
        proper_conf = suggester._calculate_confidence(
            proper_segments, 1000.0, expected_phoneme_count=3
        )

        assert proper_conf > single_conf, (
            f"Proper 3-phoneme detection ({proper_conf:.3f}) should score higher "
            f"than single-segment detection ({single_conf:.3f}) when 3 phonemes expected"
        )

    def test_confidence_no_penalty_for_extra_segments(
        self, suggester: OtoSuggester
    ) -> None:
        """Test that extra segments beyond expected count are not penalized."""
        # 2 expected phonemes, but 4 detected (valid splits)
        segments = [
            PhonemeSegment(phoneme="k", start_ms=20, end_ms=60, confidence=0.8),
            PhonemeSegment(phoneme="a", start_ms=60, end_ms=200, confidence=0.8),
            PhonemeSegment(phoneme="k", start_ms=200, end_ms=240, confidence=0.7),
            PhonemeSegment(phoneme="a", start_ms=240, end_ms=400, confidence=0.7),
        ]

        conf_with_expected = suggester._calculate_confidence(
            segments, 500.0, expected_phoneme_count=2
        )

        # Extra segments should not be penalized -- confidence should remain
        # reasonable. The count_match_score is 1.0 when detected >= expected,
        # so having 4 segments with 2 expected should not hurt the score.
        assert conf_with_expected > 0.5

    def test_confidence_count_match_score_scales(self, suggester: OtoSuggester) -> None:
        """Test that count match penalty scales with how many phonemes are missing."""
        base_segment = PhonemeSegment(
            phoneme="a", start_ms=10, end_ms=500, confidence=0.5
        )

        # 1 detected, expected 2 -> count_match = 0.5
        conf_half = suggester._calculate_confidence(
            [base_segment], 600.0, expected_phoneme_count=2
        )
        # 1 detected, expected 5 -> count_match = 0.2
        conf_fifth = suggester._calculate_confidence(
            [base_segment], 600.0, expected_phoneme_count=5
        )

        assert conf_half > conf_fifth, (
            f"Missing fewer phonemes ({conf_half:.3f}) should score higher "
            f"than missing more ({conf_fifth:.3f})"
        )


class TestEstimateExpectedPhonemeCount:
    """Test expected phoneme count estimation from filenames."""

    @pytest.fixture
    def suggester(self) -> OtoSuggester:
        """Create suggester for testing internal methods."""
        return OtoSuggester()

    def test_pure_vowel(self, suggester: OtoSuggester) -> None:
        """Pure vowel filename -> 1 expected phoneme."""
        assert suggester._estimate_expected_phoneme_count("_a.wav") == 1

    def test_cv_syllable(self, suggester: OtoSuggester) -> None:
        """CV syllable filename -> 2 expected phonemes (consonant + vowel)."""
        assert suggester._estimate_expected_phoneme_count("_ka.wav") == 2

    def test_vcv_pattern(self, suggester: OtoSuggester) -> None:
        """VCV filename '_a_ka.wav' -> 3 expected phonemes (a + k + a)."""
        count = suggester._estimate_expected_phoneme_count("_a_ka.wav")
        assert count == 3

    def test_multi_syllable(self, suggester: OtoSuggester) -> None:
        """Multi-syllable like 'a ka sa' -> 5 expected phonemes."""
        count = suggester._estimate_expected_phoneme_count("_a_ka_sa.wav")
        assert count == 5  # a(1) + ka(2) + sa(2) = 5

    def test_moraic_nasal(self, suggester: OtoSuggester) -> None:
        """Moraic nasal 'n' -> 1 expected phoneme."""
        count = suggester._estimate_expected_phoneme_count("_n.wav")
        assert count == 1

    def test_invalid_filename_returns_none(self, suggester: OtoSuggester) -> None:
        """Unrecognizable filename returns None."""
        # An empty-transcript file should return None
        count = suggester._estimate_expected_phoneme_count("息.wav")
        assert count is None


class TestSuggestOto:
    """Test the main suggest_oto method."""

    @pytest.fixture
    def mock_fa_detector(self) -> MagicMock:
        """Create mock forced alignment detector (MMS_FA)."""
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def suggester(self, mock_fa_detector: MagicMock) -> OtoSuggester:
        """Create suggester with mocked MMS_FA detector."""
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=False)
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

    @pytest.mark.asyncio
    async def test_suggest_oto_cv_sample(
        self, suggester: OtoSuggester, mock_fa_detector: MagicMock
    ) -> None:
        """Test oto suggestion for a CV sample."""
        # Mock the detection result
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[
                PhonemeSegment(phoneme="k", start_ms=25.0, end_ms=65.0, confidence=0.9),
                PhonemeSegment(
                    phoneme="a", start_ms=65.0, end_ms=200.0, confidence=0.88
                ),
            ],
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
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
        self, suggester: OtoSuggester, mock_fa_detector: MagicMock
    ) -> None:
        """Test oto suggestion with auto-generated alias."""
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=[
                PhonemeSegment(
                    phoneme="s", start_ms=20.0, end_ms=80.0, confidence=0.85
                ),
                PhonemeSegment(
                    phoneme="a", start_ms=80.0, end_ms=180.0, confidence=0.82
                ),
            ],
            audio_duration_ms=220.0,
            model_name="torchaudio-mms-fa",
        )

        suggestion = await suggester.suggest_oto(Path("/fake/path/_sa.wav"))

        assert suggestion.alias == "- sa"

    @pytest.mark.asyncio
    async def test_suggest_oto_empty_detection(
        self, suggester: OtoSuggester, mock_fa_detector: MagicMock
    ) -> None:
        """Test oto suggestion when no phonemes detected (falls to defaults)."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError

        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "Failed to process audio"
        )

        with patch("src.backend.ml.oto_suggester.librosa") as mock_librosa:
            mock_librosa.get_duration.return_value = 0.3  # 300ms
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
    def mock_fa_detector(self) -> MagicMock:
        """Create mock forced alignment detector (MMS_FA)."""
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        detector.batch_detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def mock_sofa_aligner(self) -> MagicMock:
        """Create mock SOFA aligner."""

        aligner = MagicMock()
        aligner.batch_align = AsyncMock()
        aligner.align = AsyncMock()
        return aligner

    @pytest.fixture
    def suggester_with_sofa(
        self, mock_fa_detector: MagicMock, mock_sofa_aligner: MagicMock
    ) -> OtoSuggester:
        """Create suggester with SOFA enabled and mocked."""
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

    @pytest.fixture
    def suggester_no_sofa(self, mock_fa_detector: MagicMock) -> OtoSuggester:
        """Create suggester with SOFA disabled."""
        suggester = OtoSuggester(use_forced_alignment=False, use_sofa=False)
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

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
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=60.0, end_ms=200.0, confidence=1.0
                    ),
                ],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[1]: AlignmentResult(
                segments=[
                    PhonemeSegment(
                        phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=70.0, end_ms=210.0, confidence=1.0
                    ),
                ],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "")
                .replace(".wav", "")
                .replace("", " ")
                .strip(),
            ),
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
    async def test_batch_suggest_oto_fallback_to_mms_fa_batch(
        self, suggester_with_sofa: OtoSuggester, mock_fa_detector: MagicMock
    ) -> None:
        """Falls back to batch MMS_FA when SOFA is unavailable."""
        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]

        # Mock MMS_FA batch detection result
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[0]: PhonemeDetectionResult(
                segments=[
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85
                    ),
                ],
                audio_duration_ms=250.0,
                model_name="torchaudio-mms-fa",
            ),
            audio_paths[1]: PhonemeDetectionResult(
                segments=[
                    PhonemeSegment(
                        phoneme="s", start_ms=25.0, end_ms=70.0, confidence=0.9
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=70.0, end_ms=210.0, confidence=0.85
                    ),
                ],
                audio_duration_ms=260.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify batch MMS_FA was called
        mock_fa_detector.batch_detect_phonemes.assert_called_once()

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
                segments=[
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0
                    )
                ],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[0]: AlignmentResult(
                segments=[
                    PhonemeSegment(
                        phoneme="t", start_ms=15.0, end_ms=55.0, confidence=1.0
                    )
                ],
                audio_duration_ms=240.0,
                method="sofa",
            ),
            audio_paths[2]: AlignmentResult(
                segments=[
                    PhonemeSegment(
                        phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0
                    )
                ],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
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
                segments=[
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0
                    )
                ],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[1]: AlignmentResult(
                segments=[
                    PhonemeSegment(
                        phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0
                    )
                ],
                audio_duration_ms=260.0,
                method="sofa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
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
        mock_fa_detector: MagicMock,
    ) -> None:
        """Files that fail SOFA fall through to MMS_FA batch phase."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),  # This one will fail SOFA
        ]

        # Mock SOFA batch_align returns only first file (second failed)
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=[
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0
                    )
                ],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            # audio_paths[1] is missing - simulates failure
        }

        # Mock MMS_FA batch for the file that failed SOFA
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[1]: PhonemeDetectionResult(
                segments=[
                    PhonemeSegment(
                        phoneme="s", start_ms=25.0, end_ms=70.0, confidence=0.9
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=70.0, end_ms=210.0, confidence=0.85
                    ),
                ],
                audio_duration_ms=260.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify both files have results
        assert len(result) == 2
        assert result[0].filename == "_ka.wav"
        assert result[0].method_used == "sofa"
        assert result[1].filename == "_sa.wav"
        assert result[1].method_used == "mms_fa"
        assert len(result[1].fallback_reasons) == 1
        assert "SOFA returned no result" in result[1].fallback_reasons[0]

    @pytest.mark.asyncio
    async def test_batch_suggest_oto_sofa_batch_error_falls_to_mms_fa(
        self,
        suggester_with_sofa: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When SOFA batch_align raises error, falls back to batch MMS_FA."""
        from src.backend.ml.forced_aligner import AlignmentError

        audio_paths = [Path("/test/_ka.wav")]

        # Mock SOFA batch_align to raise error
        mock_sofa_aligner.batch_align.side_effect = AlignmentError("SOFA failed")

        # Mock MMS_FA batch to succeed
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[0]: PhonemeDetectionResult(
                segments=[
                    PhonemeSegment(
                        phoneme="k", start_ms=20.0, end_ms=60.0, confidence=0.9
                    ),
                    PhonemeSegment(
                        phoneme="a", start_ms=60.0, end_ms=200.0, confidence=0.85
                    ),
                ],
                audio_duration_ms=250.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester_with_sofa.batch_suggest_oto(
                audio_paths, sofa_language="ja"
            )

        # Verify MMS_FA batch was called as fallback
        mock_fa_detector.batch_detect_phonemes.assert_called_once()
        assert len(result) == 1
        assert result[0].filename == "_ka.wav"


# ---------------------------------------------------------------------------
# Fallback chain integration tests
# ---------------------------------------------------------------------------


def _make_cv_segments(
    consonant: str = "k",
    vowel: str = "a",
    c_start: float = 20.0,
    c_end: float = 60.0,
    v_end: float = 200.0,
    confidence: float = 0.9,
) -> list[PhonemeSegment]:
    """Helper to build a simple CV segment list."""
    return [
        PhonemeSegment(
            phoneme=consonant,
            start_ms=c_start,
            end_ms=c_end,
            confidence=confidence,
        ),
        PhonemeSegment(
            phoneme=vowel,
            start_ms=c_end,
            end_ms=v_end,
            confidence=confidence,
        ),
    ]


class TestSuggestOtoFallbackChain:
    """Integration tests for the single-file suggest_oto fallback chain.

    The chain is: SOFA -> MMS_FA -> defaults.
    Each test verifies a specific transition in the chain by mocking the
    upstream method to fail and asserting the downstream method is invoked.
    """

    # -- Shared fixtures --------------------------------------------------

    @pytest.fixture
    def mock_sofa_aligner(self) -> MagicMock:
        """Create mock SOFA aligner."""
        aligner = MagicMock()
        aligner.align = AsyncMock()
        aligner.batch_align = AsyncMock()
        return aligner

    @pytest.fixture
    def mock_fa_detector(self) -> MagicMock:
        """Create mock MMS_FA forced alignment detector."""
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        detector.batch_detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def suggester_full_chain(
        self, mock_sofa_aligner: MagicMock, mock_fa_detector: MagicMock
    ) -> OtoSuggester:
        """Suggester with both SOFA and MMS_FA enabled and mocked."""
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

    # -- SOFA succeeds (no fallback needed) --------------------------------

    @pytest.mark.asyncio
    async def test_sofa_succeeds_no_fallback(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When SOFA succeeds, MMS_FA is never called."""
        from src.backend.ml.forced_aligner import AlignmentResult

        mock_sofa_aligner.align.return_value = AlignmentResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            method="sofa",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True):
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        mock_sofa_aligner.align.assert_called_once()
        mock_fa_detector.detect_phonemes.assert_not_called()
        assert suggestion.confidence > 0
        assert len(suggestion.phonemes_detected) == 2
        assert suggestion.method_used == "sofa"
        assert suggestion.fallback_reasons == []

    # -- SOFA fails with AlignmentError -> MMS_FA fallback -----------------

    @pytest.mark.asyncio
    async def test_sofa_alignment_error_falls_to_mms_fa(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When SOFA raises AlignmentError, MMS_FA is tried and succeeds."""
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA crashed")
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True):
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        mock_sofa_aligner.align.assert_called_once()
        mock_fa_detector.detect_phonemes.assert_called_once()
        assert suggestion.confidence > 0
        assert len(suggestion.phonemes_detected) == 2
        assert suggestion.method_used == "mms_fa"
        assert len(suggestion.fallback_reasons) == 1
        assert "SOFA alignment error" in suggestion.fallback_reasons[0]

    # -- SOFA fails with DictionaryValidationError -> MMS_FA fallback ------

    @pytest.mark.asyncio
    async def test_sofa_dictionary_error_falls_to_mms_fa(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When SOFA raises DictionaryValidationError, MMS_FA is tried."""
        from src.backend.ml.sofa_aligner import DictionaryValidationError

        mock_sofa_aligner.align.side_effect = DictionaryValidationError(
            "Unrecognized phonemes",
            unrecognized_phonemes={"xx"},
            transcript="xx",
        )
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(consonant="s", vowel="a"),
            audio_duration_ms=220.0,
            model_name="torchaudio-mms-fa",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True):
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_sa.wav"), alias="- sa"
            )

        mock_sofa_aligner.align.assert_called_once()
        mock_fa_detector.detect_phonemes.assert_called_once()
        assert suggestion.confidence > 0
        assert suggestion.method_used == "mms_fa"
        assert len(suggestion.fallback_reasons) == 1
        assert "SOFA dictionary validation failed" in suggestion.fallback_reasons[0]

    # -- SOFA unavailable -> MMS_FA used directly --------------------------

    @pytest.mark.asyncio
    async def test_sofa_unavailable_uses_mms_fa(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When is_sofa_available() returns False, SOFA is skipped entirely."""
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
        )

        with patch(
            "src.backend.ml.oto_suggester.is_sofa_available", return_value=False
        ):
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        mock_sofa_aligner.align.assert_not_called()
        mock_fa_detector.detect_phonemes.assert_called_once()
        assert suggestion.confidence > 0
        assert suggestion.method_used == "mms_fa"
        # No fallback reasons: SOFA was unavailable (not a failure), MMS_FA succeeded
        assert suggestion.fallback_reasons == []

    # -- MMS_FA fails with ForcedAlignmentError -> defaults ----------------

    @pytest.mark.asyncio
    async def test_mms_fa_error_falls_to_defaults(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When MMS_FA raises ForcedAlignmentError, defaults are used."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError

        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "Model load failed"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
        ):
            mock_librosa.get_duration.return_value = 0.3  # 300ms
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        assert suggestion.offset == DEFAULT_OFFSET_MS
        assert suggestion.preutterance == DEFAULT_PREUTTERANCE_MS
        assert suggestion.confidence == 0.0
        assert len(suggestion.phonemes_detected) == 0
        assert suggestion.method_used == "defaults"
        assert len(suggestion.fallback_reasons) == 1
        assert "MMS_FA forced alignment failed" in suggestion.fallback_reasons[0]

    # -- MMS_FA fails with TranscriptExtractionError -> defaults -----------

    @pytest.mark.asyncio
    async def test_mms_fa_transcript_error_falls_to_defaults(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When MMS_FA raises TranscriptExtractionError, defaults are used."""
        from src.backend.ml.forced_alignment_detector import TranscriptExtractionError

        mock_fa_detector.detect_phonemes.side_effect = TranscriptExtractionError(
            "Cannot parse filename"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
        ):
            mock_librosa.get_duration.return_value = 0.5  # 500ms
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_weird.wav"), alias="- weird"
            )

        assert suggestion.offset == DEFAULT_OFFSET_MS
        assert suggestion.preutterance == DEFAULT_PREUTTERANCE_MS
        assert suggestion.confidence == 0.0
        assert suggestion.method_used == "defaults"
        assert len(suggestion.fallback_reasons) == 1
        assert "MMS_FA forced alignment failed" in suggestion.fallback_reasons[0]

    # -- Full cascade: SOFA -> MMS_FA -> defaults --------------------------

    @pytest.mark.asyncio
    async def test_full_cascade_all_fail_returns_defaults(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When SOFA fails AND MMS_FA fails, reasonable defaults are returned."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA unavailable")
        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA unavailable"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
        ):
            mock_librosa.get_duration.return_value = 0.4  # 400ms
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        # Both methods attempted
        mock_sofa_aligner.align.assert_called_once()
        mock_fa_detector.detect_phonemes.assert_called_once()

        # Defaults applied
        assert suggestion.offset == DEFAULT_OFFSET_MS
        assert suggestion.preutterance == DEFAULT_PREUTTERANCE_MS
        assert suggestion.cutoff == -DEFAULT_CUTOFF_PADDING_MS
        assert suggestion.overlap == DEFAULT_OVERLAP_MS
        assert suggestion.confidence == 0.0
        assert suggestion.phonemes_detected == []
        assert suggestion.audio_duration_ms == 400.0
        assert suggestion.method_used == "defaults"
        assert len(suggestion.fallback_reasons) == 2
        assert "SOFA alignment error" in suggestion.fallback_reasons[0]
        assert "MMS_FA forced alignment failed" in suggestion.fallback_reasons[1]

    @pytest.mark.asyncio
    async def test_full_cascade_all_fail_librosa_also_fails(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When everything fails including librosa, duration defaults to 1000ms."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA error")
        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA error"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
        ):
            mock_librosa.get_duration.side_effect = RuntimeError("File not found")
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        # Duration falls back to 1000ms
        assert suggestion.audio_duration_ms == 1000.0
        assert suggestion.confidence == 0.0

    # -- Partial cascade: SOFA fails -> MMS_FA succeeds --------------------

    @pytest.mark.asyncio
    async def test_partial_cascade_sofa_fails_mms_fa_succeeds(
        self,
        suggester_full_chain: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """SOFA fails, MMS_FA succeeds -- verify MMS_FA result is used."""
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA timeout")

        mms_segments = _make_cv_segments(
            consonant="t", vowel="a", c_start=15.0, c_end=55.0, v_end=190.0
        )
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=mms_segments,
            audio_duration_ms=240.0,
            model_name="torchaudio-mms-fa",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True):
            suggestion = await suggester_full_chain.suggest_oto(
                Path("/fake/_ta.wav"), alias="- ta"
            )

        # SOFA tried and failed
        mock_sofa_aligner.align.assert_called_once()
        # MMS_FA used as fallback
        mock_fa_detector.detect_phonemes.assert_called_once()

        # Verify the MMS_FA segments are in the result
        assert len(suggestion.phonemes_detected) == 2
        assert suggestion.phonemes_detected[0].phoneme == "t"
        assert suggestion.phonemes_detected[1].phoneme == "a"
        assert suggestion.audio_duration_ms == 240.0
        assert suggestion.confidence > 0
        assert suggestion.method_used == "mms_fa"
        assert len(suggestion.fallback_reasons) == 1
        assert "SOFA alignment error" in suggestion.fallback_reasons[0]

    # -- method_override tests ---------------------------------------------

    @pytest.mark.asyncio
    async def test_method_override_sofa_skips_mms_fa(
        self,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """method_override='sofa' skips MMS_FA even when SOFA fails."""
        from src.backend.domain.alignment_config import AlignmentConfig
        from src.backend.ml.sofa_aligner import AlignmentError

        config = AlignmentConfig(method_override="sofa")
        suggester = OtoSuggester(
            use_forced_alignment=True, use_sofa=True, alignment_config=config
        )
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA error")

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
        ):
            mock_librosa.get_duration.return_value = 0.3
            suggestion = await suggester.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        mock_sofa_aligner.align.assert_called_once()
        # MMS_FA should NOT be called because method_override is "sofa"
        mock_fa_detector.detect_phonemes.assert_not_called()
        assert suggestion.confidence == 0.0
        assert suggestion.method_used == "defaults"
        assert len(suggestion.fallback_reasons) == 1
        assert "SOFA alignment error" in suggestion.fallback_reasons[0]

    @pytest.mark.asyncio
    async def test_method_override_fa_skips_sofa(
        self,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """method_override='fa' skips SOFA even when it is available."""
        from src.backend.domain.alignment_config import AlignmentConfig

        config = AlignmentConfig(method_override="fa")
        suggester = OtoSuggester(
            use_forced_alignment=True, use_sofa=True, alignment_config=config
        )
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector

        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
        )

        with patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True):
            suggestion = await suggester.suggest_oto(
                Path("/fake/_ka.wav"), alias="- ka"
            )

        # SOFA should NOT be called
        mock_sofa_aligner.align.assert_not_called()
        mock_fa_detector.detect_phonemes.assert_called_once()
        assert suggestion.confidence > 0
        assert suggestion.method_used == "mms_fa"
        assert suggestion.fallback_reasons == []


class TestSuggestOtoFallbackLogging:
    """Verify that failures at each stage are logged at appropriate levels.

    SOFA DictionaryValidationError -> warning
    SOFA AlignmentError -> warning
    MMS_FA ForcedAlignmentError -> warning
    MMS_FA TranscriptExtractionError -> warning
    librosa failure -> warning
    """

    @pytest.fixture
    def mock_sofa_aligner(self) -> MagicMock:
        aligner = MagicMock()
        aligner.align = AsyncMock()
        return aligner

    @pytest.fixture
    def mock_fa_detector(self) -> MagicMock:
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def suggester(
        self, mock_sofa_aligner: MagicMock, mock_fa_detector: MagicMock
    ) -> OtoSuggester:
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

    @pytest.mark.asyncio
    async def test_sofa_dictionary_error_logged_at_warning(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """DictionaryValidationError is logged at WARNING."""
        from src.backend.ml.sofa_aligner import DictionaryValidationError

        mock_sofa_aligner.align.side_effect = DictionaryValidationError(
            "Unrecognized phonemes",
            unrecognized_phonemes={"zz"},
            transcript="zz",
        )
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            await suggester.suggest_oto(Path("/fake/_ka.wav"), alias="- ka")

        # Find the dictionary validation log record
        dict_records = [
            r
            for r in caplog.records
            if "SOFA dictionary validation failed" in r.message
        ]
        assert len(dict_records) == 1
        assert dict_records[0].levelno == logging.WARNING

    @pytest.mark.asyncio
    async def test_sofa_alignment_error_logged_at_warning(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """SOFA AlignmentError is logged at WARNING."""
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA crashed")
        mock_fa_detector.detect_phonemes.return_value = PhonemeDetectionResult(
            segments=_make_cv_segments(),
            audio_duration_ms=250.0,
            model_name="torchaudio-mms-fa",
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            await suggester.suggest_oto(Path("/fake/_ka.wav"), alias="- ka")

        warn_records = [
            r for r in caplog.records if "SOFA alignment failed" in r.message
        ]
        assert len(warn_records) == 1
        assert warn_records[0].levelno == logging.WARNING

    @pytest.mark.asyncio
    async def test_mms_fa_error_logged_at_warning(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """MMS_FA ForcedAlignmentError is logged at WARNING."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError

        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "Model crash"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            mock_librosa.get_duration.return_value = 0.3
            await suggester.suggest_oto(Path("/fake/_ka.wav"), alias="- ka")

        warn_records = [
            r for r in caplog.records if "MMS_FA forced alignment failed" in r.message
        ]
        assert len(warn_records) == 1
        assert warn_records[0].levelno == logging.WARNING

    @pytest.mark.asyncio
    async def test_librosa_failure_logged_at_warning(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """When librosa.get_duration fails, a WARNING is logged."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA error")
        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA error"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            mock_librosa.get_duration.side_effect = RuntimeError("File not found")
            await suggester.suggest_oto(Path("/fake/_ka.wav"), alias="- ka")

        warn_records = [
            r for r in caplog.records if "Failed to get audio duration" in r.message
        ]
        assert len(warn_records) == 1
        assert warn_records[0].levelno == logging.WARNING

    @pytest.mark.asyncio
    async def test_full_cascade_logs_all_failures(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Full cascade failure produces warnings for each stage."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        mock_sofa_aligner.align.side_effect = AlignmentError("SOFA down")
        mock_fa_detector.detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA down"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch("src.backend.ml.oto_suggester.librosa") as mock_librosa,
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            mock_librosa.get_duration.return_value = 0.4
            await suggester.suggest_oto(Path("/fake/_ka.wav"), alias="- ka")

        # Both SOFA and MMS_FA warnings should be present
        messages = [r.message for r in caplog.records]
        assert any("SOFA alignment failed" in m for m in messages)
        assert any("MMS_FA forced alignment failed" in m for m in messages)


class TestBatchSuggestOtoFallbackChain:
    """Integration tests for the batch fallback chain.

    The batch chain is: batch SOFA -> batch MMS_FA -> None entries.
    """

    @pytest.fixture
    def mock_sofa_aligner(self) -> MagicMock:
        aligner = MagicMock()
        aligner.align = AsyncMock()
        aligner.batch_align = AsyncMock()
        return aligner

    @pytest.fixture
    def mock_fa_detector(self) -> MagicMock:
        detector = MagicMock()
        detector.detect_phonemes = AsyncMock()
        detector.batch_detect_phonemes = AsyncMock()
        return detector

    @pytest.fixture
    def suggester(
        self, mock_sofa_aligner: MagicMock, mock_fa_detector: MagicMock
    ) -> OtoSuggester:
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=True)
        suggester._sofa_aligner = mock_sofa_aligner
        suggester._forced_alignment_detector = mock_fa_detector
        return suggester

    # -- Both batch methods fail -> all None entries -----------------------

    @pytest.mark.asyncio
    async def test_batch_all_fail_returns_none_entries(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When both batch SOFA and batch MMS_FA fail, all entries are None."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        audio_paths = [Path("/test/_ka.wav"), Path("/test/_sa.wav")]

        mock_sofa_aligner.batch_align.side_effect = AlignmentError("SOFA batch failed")
        mock_fa_detector.batch_detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA batch failed"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        assert len(result) == 2
        assert result[0] is None
        assert result[1] is None

    # -- Batch SOFA partially succeeds -> MMS_FA handles remainder ---------

    @pytest.mark.asyncio
    async def test_batch_sofa_partial_then_mms_fa_remainder(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """SOFA succeeds for some files, MMS_FA picks up the rest."""
        from src.backend.ml.forced_aligner import AlignmentResult

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
            Path("/test/_ta.wav"),
        ]

        # SOFA only returns result for first file
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=_make_cv_segments(consonant="k"),
                audio_duration_ms=250.0,
                method="sofa",
            ),
        }

        # MMS_FA returns results for the remaining two
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[1]: PhonemeDetectionResult(
                segments=_make_cv_segments(consonant="s"),
                audio_duration_ms=220.0,
                model_name="torchaudio-mms-fa",
            ),
            audio_paths[2]: PhonemeDetectionResult(
                segments=_make_cv_segments(consonant="t"),
                audio_duration_ms=230.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        mock_sofa_aligner.batch_align.assert_called_once()
        mock_fa_detector.batch_detect_phonemes.assert_called_once()

        assert len(result) == 3
        # All three should have suggestions (not None)
        assert all(r is not None for r in result)
        assert result[0].filename == "_ka.wav"
        assert result[1].filename == "_sa.wav"
        assert result[2].filename == "_ta.wav"

    # -- Batch SOFA error -> entire batch falls to MMS_FA ------------------

    @pytest.mark.asyncio
    async def test_batch_sofa_error_all_fall_to_mms_fa(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When batch SOFA raises AlignmentError, all files go to batch MMS_FA."""
        from src.backend.ml.sofa_aligner import AlignmentError

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
        ]

        mock_sofa_aligner.batch_align.side_effect = AlignmentError("SOFA batch crashed")
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[0]: PhonemeDetectionResult(
                segments=_make_cv_segments(consonant="k"),
                audio_duration_ms=250.0,
                model_name="torchaudio-mms-fa",
            ),
            audio_paths[1]: PhonemeDetectionResult(
                segments=_make_cv_segments(consonant="s"),
                audio_duration_ms=220.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        mock_sofa_aligner.batch_align.assert_called_once()
        mock_fa_detector.batch_detect_phonemes.assert_called_once()
        assert len(result) == 2
        assert all(r is not None for r in result)

    # -- MMS_FA batch partial success -> some None entries -----------------

    @pytest.mark.asyncio
    async def test_batch_mms_fa_partial_success_leaves_none(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When MMS_FA batch returns partial results, missing files are None."""
        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_sa.wav"),
            Path("/test/_ta.wav"),
        ]

        # SOFA unavailable
        # MMS_FA only succeeds for first file
        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[0]: PhonemeDetectionResult(
                segments=_make_cv_segments(consonant="k"),
                audio_duration_ms=250.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=False),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        assert len(result) == 3
        assert result[0] is not None
        assert result[0].filename == "_ka.wav"
        # Remaining files failed all methods -> None
        assert result[1] is None
        assert result[2] is None

    # -- Batch logging for failed files ------------------------------------

    @pytest.mark.asyncio
    async def test_batch_logs_warning_for_failed_files(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Files that fail all batch techniques are logged at WARNING."""
        from src.backend.ml.forced_alignment_detector import ForcedAlignmentError
        from src.backend.ml.sofa_aligner import AlignmentError

        audio_paths = [Path("/test/_ka.wav")]

        mock_sofa_aligner.batch_align.side_effect = AlignmentError("SOFA error")
        mock_fa_detector.batch_detect_phonemes.side_effect = ForcedAlignmentError(
            "MMS_FA error"
        )

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
            ),
            caplog.at_level(logging.DEBUG, logger="src.backend.ml.oto_suggester"),
        ):
            await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        # Warning for SOFA batch failure
        assert any(
            "SOFA batch alignment failed entirely" in r.message for r in caplog.records
        )
        # Warning for MMS_FA batch failure
        assert any(
            "MMS_FA batch alignment failed entirely" in r.message
            for r in caplog.records
        )
        # Warning for remaining failed files
        assert any(
            "files failed all batch alignment" in r.message for r in caplog.records
        )

    # -- Batch SOFA disabled -> only MMS_FA --------------------------------

    @pytest.mark.asyncio
    async def test_batch_sofa_disabled_only_mms_fa(
        self,
        mock_fa_detector: MagicMock,
    ) -> None:
        """When use_sofa=False, only batch MMS_FA is used."""
        suggester = OtoSuggester(use_forced_alignment=True, use_sofa=False)
        suggester._forced_alignment_detector = mock_fa_detector

        audio_paths = [Path("/test/_ka.wav")]

        mock_fa_detector.batch_detect_phonemes.return_value = {
            audio_paths[0]: PhonemeDetectionResult(
                segments=_make_cv_segments(),
                audio_duration_ms=250.0,
                model_name="torchaudio-mms-fa",
            ),
        }

        with patch(
            "src.backend.ml.oto_suggester.extract_transcript_from_filename",
            side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        mock_fa_detector.batch_detect_phonemes.assert_called_once()
        assert len(result) == 1
        assert result[0] is not None

    # -- Both batch methods disabled -> all None ---------------------------

    @pytest.mark.asyncio
    async def test_batch_both_disabled_all_none(self) -> None:
        """When both SOFA and MMS_FA are disabled, all entries are None."""
        suggester = OtoSuggester(use_forced_alignment=False, use_sofa=False)

        audio_paths = [Path("/test/_ka.wav"), Path("/test/_sa.wav")]

        with patch(
            "src.backend.ml.oto_suggester.extract_transcript_from_filename",
            side_effect=lambda f: f.replace("_", "").replace(".wav", ""),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        assert len(result) == 2
        assert result[0] is None
        assert result[1] is None

    # -- TranscriptExtractionError for some files --------------------------

    @pytest.mark.asyncio
    async def test_batch_transcript_extraction_failure_skips_file(
        self,
        suggester: OtoSuggester,
        mock_sofa_aligner: MagicMock,
        mock_fa_detector: MagicMock,
    ) -> None:
        """Files whose transcripts cannot be extracted get empty transcripts."""
        from src.backend.ml.forced_aligner import AlignmentResult
        from src.backend.ml.forced_alignment_detector import TranscriptExtractionError

        audio_paths = [
            Path("/test/_ka.wav"),
            Path("/test/_weird_file.wav"),
        ]

        def mock_extract(filename: str) -> str:
            if "weird" in filename:
                raise TranscriptExtractionError("Cannot parse")
            return filename.replace("_", "").replace(".wav", "")

        # SOFA only gets called for the file with a valid transcript
        mock_sofa_aligner.batch_align.return_value = {
            audio_paths[0]: AlignmentResult(
                segments=_make_cv_segments(),
                audio_duration_ms=250.0,
                method="sofa",
            ),
        }

        with (
            patch("src.backend.ml.oto_suggester.is_sofa_available", return_value=True),
            patch(
                "src.backend.ml.oto_suggester.extract_transcript_from_filename",
                side_effect=mock_extract,
            ),
        ):
            result = await suggester.batch_suggest_oto(audio_paths, sofa_language="ja")

        assert len(result) == 2
        # First file succeeded via SOFA
        assert result[0] is not None
        assert result[0].filename == "_ka.wav"
        # Second file had empty transcript, so it was never sent to batch
        # alignment and remains None
        assert result[1] is None
