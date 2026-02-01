"""Tests for oto.ini parser utilities."""

import tempfile
from pathlib import Path

import pytest

from src.backend.domain.oto_entry import OtoEntry
from src.backend.utils.oto_parser import (
    decode_oto_bytes,
    parse_oto_file,
    parse_oto_line,
    read_oto_file,
    serialize_oto_entries,
    write_oto_file,
)


class TestOtoEntry:
    """Tests for the OtoEntry Pydantic model."""

    def test_create_valid_entry(self) -> None:
        """Test creating a valid OtoEntry."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.filename == "_ka.wav"
        assert entry.alias == "- ka"
        assert entry.offset == 45.0
        assert entry.consonant == 120.0
        assert entry.cutoff == -140.0
        assert entry.preutterance == 80.0
        assert entry.overlap == 15.0

    def test_filename_must_be_wav(self) -> None:
        """Test that filename must end with .wav."""
        with pytest.raises(ValueError, match="must end with .wav"):
            OtoEntry(
                filename="_ka.mp3",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            )

    def test_filename_wav_case_insensitive(self) -> None:
        """Test that .WAV extension is accepted."""
        entry = OtoEntry(
            filename="_ka.WAV",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.filename == "_ka.WAV"

    def test_offset_must_be_non_negative(self) -> None:
        """Test that offset must be >= 0."""
        with pytest.raises(ValueError):
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=-10.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            )

    def test_consonant_must_be_non_negative(self) -> None:
        """Test that consonant must be >= 0."""
        with pytest.raises(ValueError):
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=-10.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            )

    def test_preutterance_must_be_non_negative(self) -> None:
        """Test that preutterance must be >= 0."""
        with pytest.raises(ValueError):
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=-5.0,
                overlap=15.0,
            )

    def test_overlap_can_be_negative(self) -> None:
        """Test that overlap can be negative (creates gap instead of crossfade)."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=-20.0,
        )
        assert entry.overlap == -20.0

    def test_cutoff_can_be_negative(self) -> None:
        """Test that cutoff can be negative (from audio end)."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.cutoff == -140.0

    def test_cutoff_can_be_positive(self) -> None:
        """Test that cutoff can be positive (from audio start)."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=500.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.cutoff == 500.0

    def test_to_oto_line_integers(self) -> None:
        """Test serializing to oto.ini line format with integer values."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.to_oto_line() == "_ka.wav=- ka,45,120,-140,80,15"

    def test_to_oto_line_floats(self) -> None:
        """Test serializing to oto.ini line format with float values."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.5,
            consonant=120.25,
            cutoff=-140.75,
            preutterance=80.1,
            overlap=15.9,
        )
        assert entry.to_oto_line() == "_ka.wav=- ka,45.5,120.25,-140.75,80.1,15.9"

    def test_str_representation(self) -> None:
        """Test string representation matches oto.ini line."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert str(entry) == "_ka.wav=- ka,45,120,-140,80,15"

    def test_empty_alias(self) -> None:
        """Test that empty alias is allowed."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        assert entry.alias == ""


class TestParseOtoLine:
    """Tests for parse_oto_line function."""

    def test_parse_cv_line(self) -> None:
        """Test parsing a CV (consonant-vowel) entry."""
        entry = parse_oto_line("_ka.wav=- ka,45,120,-140,80,15")
        assert entry is not None
        assert entry.filename == "_ka.wav"
        assert entry.alias == "- ka"
        assert entry.offset == 45.0
        assert entry.consonant == 120.0
        assert entry.cutoff == -140.0
        assert entry.preutterance == 80.0
        assert entry.overlap == 15.0

    def test_parse_vcv_line(self) -> None:
        """Test parsing a VCV (vowel-consonant-vowel) entry."""
        entry = parse_oto_line("_akasa.wav=a ka,250,100,-200,70,30")
        assert entry is not None
        assert entry.filename == "_akasa.wav"
        assert entry.alias == "a ka"
        assert entry.offset == 250.0
        assert entry.consonant == 100.0
        assert entry.cutoff == -200.0
        assert entry.preutterance == 70.0
        assert entry.overlap == 30.0

    def test_parse_line_with_floats(self) -> None:
        """Test parsing a line with floating-point values."""
        entry = parse_oto_line("_ka.wav=- ka,45.5,120.25,-140.75,80.1,15.9")
        assert entry is not None
        assert entry.offset == 45.5
        assert entry.consonant == 120.25
        assert entry.cutoff == -140.75
        assert entry.preutterance == 80.1
        assert entry.overlap == 15.9

    def test_parse_empty_line(self) -> None:
        """Test that empty lines return None."""
        assert parse_oto_line("") is None
        assert parse_oto_line("   ") is None
        assert parse_oto_line("\t") is None

    def test_parse_comment_hash(self) -> None:
        """Test that # comments return None."""
        assert parse_oto_line("# This is a comment") is None
        assert parse_oto_line("#comment") is None

    def test_parse_comment_semicolon(self) -> None:
        """Test that ; comments return None."""
        assert parse_oto_line("; This is a comment") is None
        assert parse_oto_line(";comment") is None

    def test_parse_comment_double_slash(self) -> None:
        """Test that // comments return None."""
        assert parse_oto_line("// This is a comment") is None
        assert parse_oto_line("//comment") is None

    def test_parse_malformed_line_no_equals(self) -> None:
        """Test that lines without = return None."""
        assert parse_oto_line("_ka.wav- ka,45,120,-140,80,15") is None

    def test_parse_malformed_line_wrong_field_count(self) -> None:
        """Test that lines with wrong number of fields return None."""
        assert parse_oto_line("_ka.wav=- ka,45,120,-140,80") is None
        assert parse_oto_line("_ka.wav=- ka,45,120,-140,80,15,extra") is None

    def test_parse_malformed_line_non_numeric(self) -> None:
        """Test that lines with non-numeric values return None."""
        assert parse_oto_line("_ka.wav=- ka,abc,120,-140,80,15") is None

    def test_parse_line_with_whitespace(self) -> None:
        """Test parsing lines with leading/trailing whitespace."""
        entry = parse_oto_line("  _ka.wav=- ka,45,120,-140,80,15  ")
        assert entry is not None
        assert entry.filename == "_ka.wav"

    def test_parse_line_positive_cutoff(self) -> None:
        """Test parsing a line with positive cutoff."""
        entry = parse_oto_line("_ka.wav=- ka,45,120,500,80,15")
        assert entry is not None
        assert entry.cutoff == 500.0

    def test_parse_line_empty_alias(self) -> None:
        """Test parsing a line with empty alias uses filename as alias (UTAU convention)."""
        entry = parse_oto_line("_ka.wav=,45,120,-140,80,15")
        assert entry is not None
        # UTAU convention: empty alias defaults to filename without extension
        assert entry.alias == "_ka"

    def test_parse_line_japanese_alias(self) -> None:
        """Test parsing a line with Japanese alias."""
        entry = parse_oto_line("_ka.wav=- か,45,120,-140,80,15")
        assert entry is not None
        assert entry.alias == "- か"

    def test_parse_line_with_invalid_validation(self) -> None:
        """Test that lines failing validation return None."""
        # Negative offset should fail validation
        assert parse_oto_line("_ka.wav=- ka,-45,120,-140,80,15") is None


class TestParseOtoFile:
    """Tests for parse_oto_file function."""

    def test_parse_empty_file(self) -> None:
        """Test parsing an empty file."""
        entries = parse_oto_file("")
        assert entries == []

    def test_parse_single_entry(self) -> None:
        """Test parsing a file with a single entry."""
        content = "_ka.wav=- ka,45,120,-140,80,15"
        entries = parse_oto_file(content)
        assert len(entries) == 1
        assert entries[0].alias == "- ka"

    def test_parse_multiple_entries(self) -> None:
        """Test parsing a file with multiple entries."""
        content = """_ka.wav=- ka,45,120,-140,80,15
_sa.wav=- sa,50,100,-120,70,10
_ta.wav=- ta,40,110,-130,75,12"""
        entries = parse_oto_file(content)
        assert len(entries) == 3
        assert entries[0].alias == "- ka"
        assert entries[1].alias == "- sa"
        assert entries[2].alias == "- ta"

    def test_parse_file_with_comments(self) -> None:
        """Test parsing a file with comments."""
        content = """# CV samples
_ka.wav=- ka,45,120,-140,80,15
; VCV samples
_akasa.wav=a ka,250,100,-200,70,30"""
        entries = parse_oto_file(content)
        assert len(entries) == 2

    def test_parse_file_with_blank_lines(self) -> None:
        """Test parsing a file with blank lines."""
        content = """_ka.wav=- ka,45,120,-140,80,15

_sa.wav=- sa,50,100,-120,70,10

"""
        entries = parse_oto_file(content)
        assert len(entries) == 2

    def test_parse_file_with_malformed_lines(self) -> None:
        """Test that malformed lines are skipped."""
        content = """_ka.wav=- ka,45,120,-140,80,15
invalid line
_sa.wav=- sa,50,100,-120,70,10"""
        entries = parse_oto_file(content)
        assert len(entries) == 2

    def test_parse_vcv_file_multiple_aliases_per_wav(self) -> None:
        """Test parsing VCV file with multiple aliases per WAV."""
        content = """_akasa.wav=a ka,250,100,-200,70,30
_akasa.wav=a sa,550,110,-180,75,35"""
        entries = parse_oto_file(content)
        assert len(entries) == 2
        assert entries[0].filename == "_akasa.wav"
        assert entries[0].alias == "a ka"
        assert entries[1].filename == "_akasa.wav"
        assert entries[1].alias == "a sa"


class TestSerializeOtoEntries:
    """Tests for serialize_oto_entries function."""

    def test_serialize_empty_list(self) -> None:
        """Test serializing an empty list."""
        result = serialize_oto_entries([])
        assert result == ""

    def test_serialize_single_entry(self) -> None:
        """Test serializing a single entry."""
        entry = OtoEntry(
            filename="_ka.wav",
            alias="- ka",
            offset=45.0,
            consonant=120.0,
            cutoff=-140.0,
            preutterance=80.0,
            overlap=15.0,
        )
        result = serialize_oto_entries([entry])
        assert result == "_ka.wav=- ka,45,120,-140,80,15"

    def test_serialize_multiple_entries(self) -> None:
        """Test serializing multiple entries."""
        entries = [
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            ),
            OtoEntry(
                filename="_sa.wav",
                alias="- sa",
                offset=50.0,
                consonant=100.0,
                cutoff=-120.0,
                preutterance=70.0,
                overlap=10.0,
            ),
        ]
        result = serialize_oto_entries(entries)
        expected = "_ka.wav=- ka,45,120,-140,80,15\n_sa.wav=- sa,50,100,-120,70,10"
        assert result == expected


class TestRoundTrip:
    """Tests for parse -> serialize -> parse round-trip."""

    def test_round_trip_cv(self) -> None:
        """Test round-trip with CV entries."""
        original = "_ka.wav=- ka,45,120,-140,80,15"
        entries = parse_oto_file(original)
        serialized = serialize_oto_entries(entries)
        reparsed = parse_oto_file(serialized)

        assert len(reparsed) == 1
        assert reparsed[0].filename == entries[0].filename
        assert reparsed[0].alias == entries[0].alias
        assert reparsed[0].offset == entries[0].offset
        assert reparsed[0].consonant == entries[0].consonant
        assert reparsed[0].cutoff == entries[0].cutoff
        assert reparsed[0].preutterance == entries[0].preutterance
        assert reparsed[0].overlap == entries[0].overlap

    def test_round_trip_vcv(self) -> None:
        """Test round-trip with VCV entries."""
        original = """_akasa.wav=a ka,250,100,-200,70,30
_akasa.wav=a sa,550,110,-180,75,35"""
        entries = parse_oto_file(original)
        serialized = serialize_oto_entries(entries)
        reparsed = parse_oto_file(serialized)

        assert len(reparsed) == 2
        for i in range(2):
            assert reparsed[i].filename == entries[i].filename
            assert reparsed[i].alias == entries[i].alias

    def test_round_trip_mixed_content(self) -> None:
        """Test round-trip preserves entries but discards comments/blanks."""
        original = """# Header comment
_ka.wav=- ka,45,120,-140,80,15

; Section comment
_sa.wav=- sa,50,100,-120,70,10"""
        entries = parse_oto_file(original)
        serialized = serialize_oto_entries(entries)
        reparsed = parse_oto_file(serialized)

        assert len(reparsed) == 2
        # Comments are not preserved
        assert "#" not in serialized
        assert ";" not in serialized


class TestFileIO:
    """Tests for file reading/writing functions."""

    def test_write_and_read_oto_file(self) -> None:
        """Test writing and reading an oto.ini file."""
        entries = [
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            ),
            OtoEntry(
                filename="_sa.wav",
                alias="- sa",
                offset=50.0,
                consonant=100.0,
                cutoff=-120.0,
                preutterance=70.0,
                overlap=10.0,
            ),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "oto.ini"
            write_oto_file(path, entries)
            read_entries = read_oto_file(path)

            assert len(read_entries) == 2
            assert read_entries[0].alias == "- ka"
            assert read_entries[1].alias == "- sa"

    def test_read_utf8_file(self) -> None:
        """Test reading a UTF-8 encoded file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "oto.ini"
            content = "_ka.wav=- か,45,120,-140,80,15\n"
            path.write_text(content, encoding="utf-8")

            entries = read_oto_file(path)
            assert len(entries) == 1
            assert entries[0].alias == "- か"

    def test_read_shift_jis_file(self) -> None:
        """Test reading a Shift-JIS encoded file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "oto.ini"
            content = "_ka.wav=- か,45,120,-140,80,15\n"
            path.write_bytes(content.encode("cp932"))

            entries = read_oto_file(path)
            assert len(entries) == 1
            assert entries[0].alias == "- か"

    def test_read_nonexistent_file(self) -> None:
        """Test that reading a nonexistent file raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            read_oto_file("/nonexistent/path/oto.ini")


class TestDecodeOtoBytes:
    """Tests for decode_oto_bytes function."""

    def test_decode_utf8(self) -> None:
        """Test decoding UTF-8 bytes."""
        content = "_ka.wav=- か,45,120,-140,80,15"
        result = decode_oto_bytes(content.encode("utf-8"))
        assert result == content

    def test_decode_shift_jis(self) -> None:
        """Test decoding Shift-JIS bytes."""
        content = "_ka.wav=- か,45,120,-140,80,15"
        result = decode_oto_bytes(content.encode("cp932"))
        assert result == content

    def test_decode_utf8_bom(self) -> None:
        """Test decoding UTF-8 with BOM."""
        content = "_ka.wav=- ka,45,120,-140,80,15"
        bom = b"\xef\xbb\xbf"
        result = decode_oto_bytes(bom + content.encode("utf-8"))
        assert result == content  # BOM should be stripped
