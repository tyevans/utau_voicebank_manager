"""Tests for SOFA extended dictionary and validation."""

from pathlib import Path

import pytest

from src.backend.ml.sofa_aligner import (
    DictionaryValidationError,
    load_dictionary,
    validate_transcript_against_dictionary,
)


DICT_DIR = Path(__file__).parent.parent / "vendor" / "SOFA" / "dictionary"
JAPANESE_EXTENDED = DICT_DIR / "japanese_extended.txt"
JAPANESE_ORIGINAL = DICT_DIR / "japanese.txt"


class TestLoadDictionary:
    """Test dictionary loading."""

    def test_load_extended_dictionary(self) -> None:
        """Test loading extended Japanese dictionary."""
        words = load_dictionary(JAPANESE_EXTENDED)
        assert len(words) > 0
        # Check basic entries
        assert "a" in words
        assert "ka" in words
        assert "N" in words

    def test_extended_contains_single_consonants(self) -> None:
        """Test extended dictionary has single consonants."""
        words = load_dictionary(JAPANESE_EXTENDED)
        single_consonants = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "w", "y", "z"]
        for c in single_consonants:
            assert c in words, f"Missing consonant: {c}"

    def test_extended_contains_english_vowels(self) -> None:
        """Test extended dictionary has English vowel phonemes."""
        words = load_dictionary(JAPANESE_EXTENDED)
        english_vowels = ["aa", "ae", "ay", "ey", "ow", "oy", "aw", "uw", "uh", "ah", "ih", "eh"]
        for v in english_vowels:
            assert v in words, f"Missing vowel: {v}"

    def test_extended_superset_of_original(self) -> None:
        """Test extended dictionary contains all original entries."""
        original = load_dictionary(JAPANESE_ORIGINAL)
        extended = load_dictionary(JAPANESE_EXTENDED)
        missing = original - extended
        assert not missing, f"Extended dictionary missing: {missing}"


class TestValidateTranscript:
    """Test transcript validation against dictionary."""

    def test_all_recognized(self) -> None:
        """Test validation with all recognized words."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "ka ki ku ke ko", JAPANESE_EXTENDED
        )
        assert recognized == ["ka", "ki", "ku", "ke", "ko"]
        assert unrecognized == []

    def test_vcv_pattern(self) -> None:
        """Test VCV pattern validation."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "a ka", JAPANESE_EXTENDED
        )
        assert recognized == ["a", "ka"]
        assert unrecognized == []

    def test_single_consonants(self) -> None:
        """Test single consonant validation."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "b d f g", JAPANESE_EXTENDED
        )
        assert recognized == ["b", "d", "f", "g"]
        assert unrecognized == []

    def test_partial_recognition(self) -> None:
        """Test partial recognition (some words unknown)."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "ka xyz", JAPANESE_EXTENDED
        )
        assert recognized == ["ka"]
        assert unrecognized == ["xyz"]

    def test_all_unrecognized_raises(self) -> None:
        """Test that all unrecognized words raises error."""
        with pytest.raises(DictionaryValidationError) as exc_info:
            validate_transcript_against_dictionary("xyz abc", JAPANESE_EXTENDED)

        error = exc_info.value
        assert "xyz" in error.unrecognized_phonemes
        assert "abc" in error.unrecognized_phonemes
        assert error.transcript == "xyz abc"


class TestDictionaryValidationError:
    """Test DictionaryValidationError exception."""

    def test_error_attributes(self) -> None:
        """Test error has expected attributes."""
        error = DictionaryValidationError(
            "Test error",
            unrecognized_phonemes={"foo", "bar"},
            transcript="foo bar baz",
        )
        assert str(error) == "Test error"
        assert error.unrecognized_phonemes == {"foo", "bar"}
        assert error.transcript == "foo bar baz"

    def test_error_default_attributes(self) -> None:
        """Test error with default attributes."""
        error = DictionaryValidationError("Test error")
        assert error.unrecognized_phonemes == set()
        assert error.transcript == ""
