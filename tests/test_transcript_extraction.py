"""Tests for UTAU transcript extraction from filenames.

Tests the extract_transcript_from_filename and extract_transcript_with_metadata
functions, which handle UTAU-specific notation markers like:
- 子音 (shiin) - consonant-only samples
- ゛ (standalone dakuten) - growl/power variants
- 息, 吸 - breath samples
- R, ・ - rest/silence markers
"""

import pytest

from src.backend.ml.forced_alignment_detector import (
    TranscriptExtractionError,
    TranscriptResult,
    extract_transcript_from_filename,
    extract_transcript_with_metadata,
)


class TestExtractTranscriptFromFilename:
    """Test the basic extract_transcript_from_filename function."""

    def test_basic_cv_romaji(self) -> None:
        """Test basic CV romaji filename."""
        assert extract_transcript_from_filename("_ka.wav") == "ka"
        assert extract_transcript_from_filename("_shi.wav") == "shi"
        assert extract_transcript_from_filename("_tsu.wav") == "tsu"

    def test_basic_cv_hiragana(self) -> None:
        """Test basic CV hiragana filename."""
        assert extract_transcript_from_filename("あ.wav") == "a"
        assert extract_transcript_from_filename("か.wav") == "ka"
        assert extract_transcript_from_filename("し.wav") == "shi"

    def test_vcv_romaji(self) -> None:
        """Test VCV-style romaji filename."""
        assert extract_transcript_from_filename("_a_ka.wav") == "a ka"
        assert extract_transcript_from_filename("a_ka.wav") == "a ka"

    def test_vcv_hiragana(self) -> None:
        """Test VCV-style hiragana filename."""
        result = extract_transcript_from_filename("_ああいあうあえあおあ.wav")
        assert result == "a a i a u a e a o a"

    def test_consonant_only_marker_stripped(self) -> None:
        """Test that 子音 (consonant-only) marker is stripped."""
        # か子音.wav should produce "ka", not "ka 子 音"
        assert extract_transcript_from_filename("か子音.wav") == "ka"
        assert extract_transcript_from_filename("_ka子音.wav") == "ka"

    def test_growl_marker_stripped(self) -> None:
        """Test that standalone ゛ (growl marker) is stripped."""
        # あ゛.wav should produce "a", not "a ゛"
        assert extract_transcript_from_filename("あ゛.wav") == "a"
        assert extract_transcript_from_filename("か゛.wav") == "ka"

    def test_combined_markers(self) -> None:
        """Test handling of combined markers."""
        # Consonant-only + growl
        assert extract_transcript_from_filename("か子音゛.wav") == "ka"

    def test_numeric_prefix_stripped(self) -> None:
        """Test that numeric prefixes are stripped."""
        assert extract_transcript_from_filename("01_ka.wav") == "ka"
        assert extract_transcript_from_filename("01-ka.wav") == "ka"

    def test_multiple_underscores_stripped(self) -> None:
        """Test that leading underscores are stripped."""
        assert extract_transcript_from_filename("__ka.wav") == "ka"
        assert extract_transcript_from_filename("___ka.wav") == "ka"


class TestExtractTranscriptWithMetadata:
    """Test the full extract_transcript_with_metadata function."""

    def test_basic_cv_no_flags(self) -> None:
        """Test basic CV returns no special flags."""
        result = extract_transcript_with_metadata("か.wav")

        assert result.transcript == "ka"
        assert result.is_consonant_only is False
        assert result.is_growl_variant is False
        assert result.is_breath_sample is False
        assert result.is_rest_marker is False
        assert result.original_filename == "か.wav"

    def test_consonant_only_flag(self) -> None:
        """Test 子音 suffix sets is_consonant_only flag."""
        result = extract_transcript_with_metadata("か子音.wav")

        assert result.transcript == "ka"
        assert result.is_consonant_only is True
        assert result.is_growl_variant is False

    def test_growl_variant_flag(self) -> None:
        """Test standalone ゛ sets is_growl_variant flag."""
        result = extract_transcript_with_metadata("あ゛.wav")

        assert result.transcript == "a"
        assert result.is_consonant_only is False
        assert result.is_growl_variant is True

    def test_combined_consonant_and_growl(self) -> None:
        """Test both flags can be set simultaneously."""
        result = extract_transcript_with_metadata("か子音゛.wav")

        assert result.transcript == "ka"
        assert result.is_consonant_only is True
        assert result.is_growl_variant is True

    def test_breath_sample_japanese(self) -> None:
        """Test 息 (breath) marker sets is_breath_sample flag."""
        result = extract_transcript_with_metadata("息.wav")

        assert result.transcript == ""
        assert result.is_breath_sample is True
        assert result.is_consonant_only is False

    def test_breath_sample_inhale(self) -> None:
        """Test 吸 (inhale) marker sets is_breath_sample flag."""
        result = extract_transcript_with_metadata("吸.wav")

        assert result.transcript == ""
        assert result.is_breath_sample is True

    def test_breath_sample_english(self) -> None:
        """Test English breath markers."""
        result = extract_transcript_with_metadata("br.wav")
        assert result.transcript == ""
        assert result.is_breath_sample is True

        result = extract_transcript_with_metadata("breath.wav")
        assert result.transcript == ""
        assert result.is_breath_sample is True

    def test_rest_marker_r(self) -> None:
        """Test R (rest) marker sets is_rest_marker flag."""
        result = extract_transcript_with_metadata("R.wav")

        assert result.transcript == ""
        assert result.is_rest_marker is True
        assert result.is_breath_sample is False

    def test_rest_marker_dot(self) -> None:
        """Test ・ (rest) marker sets is_rest_marker flag."""
        result = extract_transcript_with_metadata("・.wav")

        assert result.transcript == ""
        assert result.is_rest_marker is True

    def test_rest_marker_hyphen(self) -> None:
        """Test - (rest) marker sets is_rest_marker flag."""
        result = extract_transcript_with_metadata("-.wav")

        assert result.transcript == ""
        assert result.is_rest_marker is True

    def test_rest_marker_english(self) -> None:
        """Test English rest markers."""
        result = extract_transcript_with_metadata("rest.wav")
        assert result.transcript == ""
        assert result.is_rest_marker is True

        result = extract_transcript_with_metadata("sil.wav")
        assert result.transcript == ""
        assert result.is_rest_marker is True

    def test_vcv_preserved(self) -> None:
        """Test VCV patterns are preserved correctly."""
        result = extract_transcript_with_metadata("_ああいあうあえあおあ.wav")

        assert result.transcript == "a a i a u a e a o a"
        assert result.is_consonant_only is False
        assert result.is_growl_variant is False

    def test_original_filename_preserved(self) -> None:
        """Test original filename is stored in result."""
        result = extract_transcript_with_metadata("path/to/か子音.wav")

        # Original filename includes path (stem extraction happens internally)
        assert result.original_filename == "path/to/か子音.wav"
        assert result.transcript == "ka"


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_after_processing_raises(self) -> None:
        """Test that filename empty after marker stripping raises error."""
        # Filenames that become empty after processing should raise
        with pytest.raises(TranscriptExtractionError):
            # Just numeric prefix with no content
            extract_transcript_from_filename("01_.wav")

    def test_dot_wav_passthrough(self) -> None:
        """Test that .wav (hidden file) passes through stem as-is."""
        # Note: Path('.wav').stem == '.wav' (it's a hidden file, no extension)
        # This is valid input that produces '.wav' as transcript
        result = extract_transcript_from_filename(".wav")
        assert result == ".wav"

    def test_only_underscores_raises(self) -> None:
        """Test that filename with only underscores raises error."""
        with pytest.raises(TranscriptExtractionError):
            extract_transcript_from_filename("___.wav")

    def test_voiced_kana_not_affected(self) -> None:
        """Test that voiced kana (combined dakuten) work correctly.

        The standalone dakuten ゛ is different from voiced kana like が, ざ
        which have the dakuten combined into the character.
        """
        # These should work normally
        assert extract_transcript_from_filename("が.wav") == "ga"
        assert extract_transcript_from_filename("ざ.wav") == "za"
        assert extract_transcript_from_filename("だ.wav") == "da"
        assert extract_transcript_from_filename("ば.wav") == "ba"

    def test_multiple_kana_with_growl(self) -> None:
        """Test multi-kana filename with growl marker."""
        result = extract_transcript_with_metadata("かき゛.wav")

        # The ゛ should be stripped from the end
        assert result.transcript == "ka ki"
        assert result.is_growl_variant is True

    def test_katakana_support(self) -> None:
        """Test katakana filenames work correctly."""
        assert extract_transcript_from_filename("ア.wav") == "a"
        assert extract_transcript_from_filename("カ.wav") == "ka"

    def test_katakana_with_markers(self) -> None:
        """Test katakana with UTAU markers."""
        result = extract_transcript_with_metadata("カ子音.wav")

        assert result.transcript == "ka"
        assert result.is_consonant_only is True


class TestKanaRomajiIntegration:
    """Test integration with kana_to_romaji module."""

    def test_standalone_dakuten_skipped_in_conversion(self) -> None:
        """Test that standalone dakuten doesn't appear in romaji output."""
        from src.backend.utils.kana_romaji import kana_to_romaji

        # Standalone dakuten should be skipped
        assert kana_to_romaji("あ゛") == "a"
        assert kana_to_romaji("か゛") == "ka"

        # Multiple characters with dakuten at end
        assert kana_to_romaji("かき゛") == "ka ki"

    def test_combined_dakuten_preserved(self) -> None:
        """Test that combined dakuten (voiced kana) work correctly."""
        from src.backend.utils.kana_romaji import kana_to_romaji

        # Voiced kana should produce voiced romaji
        assert kana_to_romaji("が") == "ga"
        assert kana_to_romaji("ざ") == "za"
        assert kana_to_romaji("だ") == "da"
        assert kana_to_romaji("ば") == "ba"

    def test_handakuten_skipped(self) -> None:
        """Test that standalone handakuten is also skipped."""
        from src.backend.utils.kana_romaji import kana_to_romaji

        # Standalone handakuten should be skipped
        assert kana_to_romaji("は゜") == "ha"

        # Combined handakuten (pa, pi, etc.) should work
        assert kana_to_romaji("ぱ") == "pa"
