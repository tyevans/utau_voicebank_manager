"""Tests for SOFA extended dictionary and validation."""

from pathlib import Path

import pytest

from src.backend.ml.sofa_aligner import (
    DictionaryValidationError,
    decompose_unknown_word,
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
        single_consonants = [
            "b",
            "d",
            "f",
            "g",
            "h",
            "k",
            "l",
            "m",
            "n",
            "p",
            "r",
            "s",
            "t",
            "w",
            "y",
            "z",
        ]
        for c in single_consonants:
            assert c in words, f"Missing consonant: {c}"

    def test_extended_contains_english_vowels(self) -> None:
        """Test extended dictionary has English vowel phonemes."""
        words = load_dictionary(JAPANESE_EXTENDED)
        english_vowels = [
            "aa",
            "ae",
            "ay",
            "ey",
            "ow",
            "oy",
            "aw",
            "uw",
            "uh",
            "ah",
            "ih",
            "eh",
        ]
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

    def test_decomposition_resolves_concatenated_vcv(self) -> None:
        """Test that concatenated VCV words are decomposed into known entries.

        For example, "akasa" is not in the dictionary but "a" + "ka" + "sa" are.
        The validator should decompose it and return the parts as recognized.
        """
        recognized, unrecognized = validate_transcript_against_dictionary(
            "akasa", JAPANESE_EXTENDED
        )
        assert recognized == ["a", "ka", "sa"]
        assert unrecognized == []

    def test_decomposition_mixed_known_and_decomposable(self) -> None:
        """Test mix of directly known words and decomposable unknowns."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "ka akasa", JAPANESE_EXTENDED
        )
        assert recognized == ["ka", "a", "ka", "sa"]
        assert unrecognized == []

    def test_decomposition_preserves_order(self) -> None:
        """Test that decomposition preserves word ordering in transcript."""
        recognized, unrecognized = validate_transcript_against_dictionary(
            "a kashi", JAPANESE_EXTENDED
        )
        # "a" is known, "kashi" should decompose to "ka" + "shi"
        assert recognized == ["a", "ka", "shi"]
        assert unrecognized == []

    def test_all_unrecognized_raises(self) -> None:
        """Test that all unrecognized words raises error."""
        with pytest.raises(DictionaryValidationError) as exc_info:
            validate_transcript_against_dictionary("xyz qqq", JAPANESE_EXTENDED)

        error = exc_info.value
        assert "xyz" in error.unrecognized_phonemes
        assert "qqq" in error.unrecognized_phonemes
        assert error.transcript == "xyz qqq"


class TestDecomposeUnknownWord:
    """Test word decomposition into dictionary entries."""

    def test_simple_decomposition(self) -> None:
        """Test basic decomposition of concatenated syllables."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        result = decompose_unknown_word("aka", dictionary)
        assert result == ["a", "ka"]

    def test_three_part_decomposition(self) -> None:
        """Test decomposition into three known entries."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        result = decompose_unknown_word("akasa", dictionary)
        assert result == ["a", "ka", "sa"]

    def test_no_decomposition_possible(self) -> None:
        """Test that truly unknown words return None."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        result = decompose_unknown_word("xyzqqq", dictionary)
        assert result is None

    def test_already_known_word_returns_none(self) -> None:
        """Test that a word already in the dictionary returns None.

        decompose_unknown_word is only called for unknown words, but if
        somehow called with a known word, it should return None (not a
        single-element list) since no decomposition is needed.
        """
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        # "ka" is in the dictionary as a single entry
        result = decompose_unknown_word("ka", dictionary)
        assert result is None

    def test_prefers_longer_matches(self) -> None:
        """Test that decomposition prefers fewer, longer matches."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        # "sha" is in the dictionary as one entry; should not split to "s"+"ha"
        # "sha" + "ka" is preferred over "s"+"ha"+"ka"
        result = decompose_unknown_word("shaka", dictionary)
        assert result is not None
        assert len(result) == 2
        assert result == ["sha", "ka"]

    def test_empty_word_returns_none(self) -> None:
        """Test that empty word returns None."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        result = decompose_unknown_word("", dictionary)
        assert result is None

    def test_single_char_decomposition(self) -> None:
        """Test decomposition where parts are single characters."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        # "ae" is in the extended dictionary as a single entry
        result = decompose_unknown_word("ae", dictionary)
        # Should return None because "ae" IS in dictionary as one entry
        assert result is None

    def test_vcv_concatenated_phrase(self) -> None:
        """Test VCV-style concatenated phrase decomposition."""
        dictionary = load_dictionary(JAPANESE_EXTENDED)
        result = decompose_unknown_word("ika", dictionary)
        assert result == ["i", "ka"]


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
