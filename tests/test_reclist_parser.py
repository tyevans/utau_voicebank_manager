"""Tests for custom recording list parser and API endpoint."""

import pytest
from fastapi.testclient import TestClient

from src.backend.domain.recording_list import (
    ReclistEntry,
    ReclistParseRequest,
    RecordingList,
)
from src.backend.services.reclist_service import ReclistService, ReclistValidationError
from src.backend.utils.reclist_parser import (
    MAX_RECLIST_ENTRIES,
    MAX_RECLIST_FILE_SIZE,
    ReclistParseError,
    decode_reclist_bytes,
    detect_format,
    parse_reclist,
)

# ---------------------------------------------------------------------------
# detect_format
# ---------------------------------------------------------------------------


class TestDetectFormat:
    """Tests for format auto-detection."""

    def test_plain_text(self) -> None:
        """Plain text lines (no tabs) detected as plain."""
        lines = ["ka", "ki", "ku", "ke", "ko"]
        assert detect_format(lines) == "plain"

    def test_oremo_style(self) -> None:
        """Tab-separated lines detected as OREMO."""
        lines = ["_ka\tka", "_ki\tki"]
        assert detect_format(lines) == "oremo"

    def test_empty_and_comments_only(self) -> None:
        """File with only blanks and comments defaults to plain."""
        lines = ["# header", "", "; comment", ""]
        assert detect_format(lines) == "plain"

    def test_mixed_with_tab(self) -> None:
        """If any data line has a tab, classify as OREMO."""
        lines = ["# comment", "ka", "_ki\tki"]
        assert detect_format(lines) == "oremo"

    def test_empty_list(self) -> None:
        """Empty line list defaults to plain."""
        assert detect_format([]) == "plain"


# ---------------------------------------------------------------------------
# parse_reclist — plain text
# ---------------------------------------------------------------------------


class TestParsePlainText:
    """Tests for plain text recording list parsing."""

    def test_simple_list(self) -> None:
        """Parse a simple one-alias-per-line list."""
        content = "ka\nki\nku\nke\nko"
        entries, fmt, warnings = parse_reclist(content)
        assert fmt == "plain"
        assert len(entries) == 5
        assert entries[0].alias == "ka"
        assert entries[4].alias == "ko"
        assert warnings == []

    def test_indices_are_sequential(self) -> None:
        """Entries get sequential zero-based indices."""
        content = "a\nb\nc"
        entries, _, _ = parse_reclist(content)
        assert [e.index for e in entries] == [0, 1, 2]

    def test_comment_headers_become_categories(self) -> None:
        """Comment lines starting with # set category for following entries."""
        content = "# k-row\nka\nki\n# s-row\nsa\nsi"
        entries, _, _ = parse_reclist(content)
        assert entries[0].category == "k-row"
        assert entries[1].category == "k-row"
        assert entries[2].category == "s-row"
        assert entries[3].category == "s-row"

    def test_semicolon_comments(self) -> None:
        """Semicolon comments also work as category headers."""
        content = "; vowels\na\ni\nu"
        entries, _, _ = parse_reclist(content)
        assert entries[0].category == "vowels"

    def test_blank_lines_skipped(self) -> None:
        """Blank lines are silently skipped."""
        content = "ka\n\n\nki\n  \nku"
        entries, _, warnings = parse_reclist(content)
        assert len(entries) == 3
        assert warnings == []

    def test_whitespace_stripped(self) -> None:
        """Leading/trailing whitespace is stripped from aliases."""
        content = "  ka  \n  ki  "
        entries, _, _ = parse_reclist(content)
        assert entries[0].alias == "ka"
        assert entries[1].alias == "ki"

    def test_empty_file_raises(self) -> None:
        """Empty file raises ReclistParseError."""
        with pytest.raises(ReclistParseError, match="empty"):
            parse_reclist("")

    def test_whitespace_only_raises(self) -> None:
        """File with only whitespace raises ReclistParseError."""
        with pytest.raises(ReclistParseError, match="empty"):
            parse_reclist("   \n  \n  ")

    def test_comments_only_raises(self) -> None:
        """File with only comments and no entries raises ReclistParseError."""
        with pytest.raises(ReclistParseError, match="No valid entries"):
            parse_reclist("# header\n; another comment")

    def test_long_line_skipped_with_warning(self) -> None:
        """Lines exceeding 200 characters are skipped with a warning."""
        content = "ka\n" + "x" * 201 + "\nki"
        entries, _, warnings = parse_reclist(content)
        assert len(entries) == 2
        assert len(warnings) == 1
        assert "200 characters" in warnings[0]

    def test_vcv_aliases(self) -> None:
        """VCV-style aliases with spaces are preserved."""
        content = "a ka\na ki\na ku"
        entries, _, _ = parse_reclist(content)
        assert entries[0].alias == "a ka"
        assert entries[1].alias == "a ki"

    def test_arpasing_aliases(self) -> None:
        """ARPAsing-style aliases are preserved."""
        content = "- k ae t\n- b ae t"
        entries, _, _ = parse_reclist(content)
        assert entries[0].alias == "- k ae t"

    def test_unicode_aliases(self) -> None:
        """Non-ASCII aliases (Korean, Chinese, etc.) are preserved."""
        content = "ka\nki"
        entries, _, _ = parse_reclist(content)
        assert len(entries) == 2

    def test_korean_aliases(self) -> None:
        """Korean hangul aliases are preserved."""
        content = "ga\nna\nda\nra"
        entries, _, _ = parse_reclist(content)
        assert len(entries) == 4
        assert entries[0].alias == "ga"

    def test_empty_comment_header_ignored(self) -> None:
        """A comment line with no text after # does not change category."""
        content = "# row-a\nka\n#\nki"
        entries, _, _ = parse_reclist(content)
        assert entries[0].category == "row-a"
        assert entries[1].category == "row-a"  # unchanged since # had no text

    def test_plain_no_filename_hint(self) -> None:
        """Plain text entries have no filename_hint."""
        content = "ka\nki"
        entries, _, _ = parse_reclist(content)
        assert entries[0].filename_hint is None


# ---------------------------------------------------------------------------
# parse_reclist — OREMO style
# ---------------------------------------------------------------------------


class TestParseOremoStyle:
    """Tests for OREMO-style tab-separated recording list parsing."""

    def test_basic_oremo(self) -> None:
        """Parse basic OREMO format with filename and alias."""
        content = "_ka\tka\n_ki\tki\n_ku\tku"
        entries, fmt, warnings = parse_reclist(content)
        assert fmt == "oremo"
        assert len(entries) == 3
        assert entries[0].alias == "ka"
        assert entries[0].filename_hint == "_ka"
        assert warnings == []

    def test_oremo_with_comments(self) -> None:
        """OREMO format with comment lines as category headers."""
        content = "# vowels\n_a\ta\n_i\ti\n# consonants\n_ka\tka"
        entries, fmt, _ = parse_reclist(content)
        assert fmt == "oremo"
        assert entries[0].category == "vowels"
        assert entries[1].category == "vowels"
        assert entries[2].category == "consonants"

    def test_oremo_with_third_column_comment(self) -> None:
        """OREMO format with optional third column as comment."""
        content = "_ka\tka\tpronounce clearly"
        entries, _, _ = parse_reclist(content)
        assert entries[0].comment == "pronounce clearly"
        assert entries[0].alias == "ka"
        assert entries[0].filename_hint == "_ka"

    def test_oremo_empty_alias_skipped(self) -> None:
        """OREMO lines with empty alias column are skipped."""
        content = "_ka\t\n_ki\tki"
        entries, _, warnings = parse_reclist(content)
        assert len(entries) == 1
        assert entries[0].alias == "ki"
        assert len(warnings) == 1
        assert "empty alias" in warnings[0]

    def test_oremo_vcv_aliases(self) -> None:
        """OREMO format with VCV-style aliases containing spaces."""
        content = "_akasa\ta ka\n_akasa\ta sa"
        entries, _, _ = parse_reclist(content)
        assert entries[0].alias == "a ka"
        assert entries[1].alias == "a sa"

    def test_oremo_mixed_with_plain_fallback(self) -> None:
        """Lines without tabs in an OREMO file fall back to plain-text parsing."""
        content = "_ka\tka\nplain_line\n_ki\tki"
        entries, fmt, _ = parse_reclist(content)
        assert fmt == "oremo"
        assert len(entries) == 3
        assert entries[1].alias == "plain_line"
        assert entries[1].filename_hint is None


# ---------------------------------------------------------------------------
# parse_reclist — edge cases and limits
# ---------------------------------------------------------------------------


class TestParseEdgeCases:
    """Tests for edge cases and limits."""

    def test_single_entry(self) -> None:
        """File with a single entry parses correctly."""
        content = "ka"
        entries, _, _ = parse_reclist(content)
        assert len(entries) == 1

    def test_trailing_newline(self) -> None:
        """Trailing newlines don't create extra entries."""
        content = "ka\nki\n\n\n"
        entries, _, _ = parse_reclist(content)
        assert len(entries) == 2

    def test_carriage_return_handling(self) -> None:
        """Windows-style CRLF line endings are handled."""
        content = "ka\r\nki\r\nku\r\n"
        entries, _, _ = parse_reclist(content)
        assert len(entries) == 3
        assert entries[0].alias == "ka"

    def test_max_entries_limit(self) -> None:
        """Parsing stops after MAX_RECLIST_ENTRIES with a warning."""
        content = "\n".join(f"entry_{i}" for i in range(MAX_RECLIST_ENTRIES + 100))
        entries, _, warnings = parse_reclist(content)
        assert len(entries) == MAX_RECLIST_ENTRIES
        assert any("maximum" in w.lower() for w in warnings)


# ---------------------------------------------------------------------------
# decode_reclist_bytes
# ---------------------------------------------------------------------------


class TestDecodeReclistBytes:
    """Tests for encoding auto-detection."""

    def test_utf8(self) -> None:
        """UTF-8 bytes decoded correctly."""
        content = "ka\nki\nku"
        result = decode_reclist_bytes(content.encode("utf-8"))
        assert result == content

    def test_utf8_bom(self) -> None:
        """UTF-8 with BOM decoded correctly (BOM stripped)."""
        content = "ka\nki"
        bom = b"\xef\xbb\xbf"
        result = decode_reclist_bytes(bom + content.encode("utf-8"))
        assert result == content

    def test_shift_jis(self) -> None:
        """Shift-JIS bytes decoded correctly."""
        content = "ka"
        result = decode_reclist_bytes(content.encode("cp932"))
        assert "ka" in result

    def test_file_too_large(self) -> None:
        """Oversized files raise ReclistParseError."""
        data = b"x" * (MAX_RECLIST_FILE_SIZE + 1)
        with pytest.raises(ReclistParseError, match="too large"):
            decode_reclist_bytes(data)


# ---------------------------------------------------------------------------
# RecordingList domain model
# ---------------------------------------------------------------------------


class TestRecordingListModel:
    """Tests for the RecordingList Pydantic model."""

    def _make_entries(self, count: int = 3) -> list[ReclistEntry]:
        """Create sample entries for testing."""
        return [
            ReclistEntry(alias=f"alias_{i}", index=i, category="test")
            for i in range(count)
        ]

    def test_total_entries_computed(self) -> None:
        """total_entries is computed from entries list length."""
        rl = RecordingList(
            name="test",
            format_detected="plain",
            entries=self._make_entries(5),
        )
        assert rl.total_entries == 5

    def test_categories_computed(self) -> None:
        """categories returns sorted unique categories."""
        entries = [
            ReclistEntry(alias="a", index=0, category="vowels"),
            ReclistEntry(alias="ka", index=1, category="k-row"),
            ReclistEntry(alias="i", index=2, category="vowels"),
            ReclistEntry(alias="sa", index=3, category=None),
        ]
        rl = RecordingList(
            name="test",
            format_detected="plain",
            entries=entries,
        )
        assert rl.categories == ["k-row", "vowels"]

    def test_prompts_computed(self) -> None:
        """prompts returns list of alias texts."""
        entries = [
            ReclistEntry(alias="ka", index=0),
            ReclistEntry(alias="ki", index=1),
            ReclistEntry(alias="ku", index=2),
        ]
        rl = RecordingList(
            name="test",
            format_detected="plain",
            entries=entries,
        )
        assert rl.prompts == ["ka", "ki", "ku"]

    def test_defaults(self) -> None:
        """Default values for language, style, and warnings."""
        rl = RecordingList(
            name="test",
            format_detected="plain",
            entries=self._make_entries(1),
        )
        assert rl.language == "other"
        assert rl.style == "custom"
        assert rl.warnings == []


# ---------------------------------------------------------------------------
# ReclistService
# ---------------------------------------------------------------------------


class TestReclistService:
    """Tests for the ReclistService business logic."""

    @pytest.fixture()
    def service(self) -> ReclistService:
        """Create a ReclistService instance."""
        return ReclistService()

    @pytest.mark.asyncio()
    async def test_parse_plain_upload(self, service: ReclistService) -> None:
        """Parse a plain text upload successfully."""
        content = "# k-row\nka\nki\nku"
        request = ReclistParseRequest(name="My Reclist", language="ja", style="cv")

        result = await service.parse_upload(content.encode("utf-8"), request)

        assert isinstance(result, RecordingList)
        assert result.name == "My Reclist"
        assert result.language == "ja"
        assert result.style == "cv"
        assert result.format_detected == "plain"
        assert result.total_entries == 3
        assert result.prompts == ["ka", "ki", "ku"]

    @pytest.mark.asyncio()
    async def test_parse_oremo_upload(self, service: ReclistService) -> None:
        """Parse an OREMO-style upload successfully."""
        content = "_ka\tka\n_ki\tki"
        request = ReclistParseRequest(name="OREMO List")

        result = await service.parse_upload(content.encode("utf-8"), request)

        assert result.format_detected == "oremo"
        assert result.total_entries == 2
        assert result.entries[0].filename_hint == "_ka"

    @pytest.mark.asyncio()
    async def test_parse_empty_raises(self, service: ReclistService) -> None:
        """Empty file raises ReclistValidationError."""
        request = ReclistParseRequest(name="Empty")
        with pytest.raises(ReclistValidationError, match="empty"):
            await service.parse_upload(b"", request)

    @pytest.mark.asyncio()
    async def test_parse_too_large_raises(self, service: ReclistService) -> None:
        """Oversized file raises ReclistValidationError."""
        request = ReclistParseRequest(name="Huge")
        data = b"x\n" * (MAX_RECLIST_FILE_SIZE + 1)
        with pytest.raises(ReclistValidationError, match="too large"):
            await service.parse_upload(data, request)


# ---------------------------------------------------------------------------
# API endpoint integration test
# ---------------------------------------------------------------------------


class TestReclistEndpoint:
    """Integration tests for the POST /api/v1/reclists/parse endpoint."""

    @pytest.fixture()
    def client(self) -> TestClient:
        """Create a test client for the FastAPI app."""
        from src.backend.main import app

        return TestClient(app, raise_server_exceptions=False)

    def test_parse_plain_text_file(self, client: TestClient) -> None:
        """POST a plain text reclist file and get parsed preview."""
        content = b"# k-row\nka\nki\nku\nke\nko"
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("reclist.txt", content, "text/plain")},
            data={"name": "Japanese CV", "language": "ja", "style": "cv"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Japanese CV"
        assert body["language"] == "ja"
        assert body["style"] == "cv"
        assert body["format_detected"] == "plain"
        assert body["total_entries"] == 5
        assert body["prompts"] == ["ka", "ki", "ku", "ke", "ko"]
        assert body["categories"] == ["k-row"]

    def test_parse_oremo_file(self, client: TestClient) -> None:
        """POST an OREMO-style reclist file and get parsed preview."""
        content = b"_ka\tka\n_ki\tki\n_ku\tku"
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("reclist.txt", content, "text/plain")},
            data={"name": "OREMO List"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["format_detected"] == "oremo"
        assert body["total_entries"] == 3
        assert body["entries"][0]["filename_hint"] == "_ka"
        assert body["entries"][0]["alias"] == "ka"

    def test_parse_empty_file_returns_400(self, client: TestClient) -> None:
        """POST an empty file returns 400."""
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("empty.txt", b"", "text/plain")},
            data={"name": "Empty"},
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_parse_comments_only_returns_400(self, client: TestClient) -> None:
        """POST a file with only comments returns 400."""
        content = b"# just a comment\n; another comment"
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("comments.txt", content, "text/plain")},
            data={"name": "Comments Only"},
        )
        assert response.status_code == 400
        assert "no valid entries" in response.json()["detail"].lower()

    def test_parse_default_language_and_style(self, client: TestClient) -> None:
        """When language and style are omitted, defaults are used."""
        content = b"ka\nki\nku"
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("reclist.txt", content, "text/plain")},
            data={"name": "Defaults"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["language"] == "other"
        assert body["style"] == "custom"

    def test_parse_with_warnings(self, client: TestClient) -> None:
        """File with problematic lines returns warnings alongside entries."""
        long_line = "x" * 201
        content = f"ka\n{long_line}\nki".encode()
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("reclist.txt", content, "text/plain")},
            data={"name": "With Warnings"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total_entries"] == 2
        assert len(body["warnings"]) == 1
        assert "200 characters" in body["warnings"][0]

    def test_missing_name_returns_422(self, client: TestClient) -> None:
        """Missing required 'name' field returns 422."""
        content = b"ka\nki"
        response = client.post(
            "/api/v1/reclists/parse",
            files={"file": ("reclist.txt", content, "text/plain")},
            data={},
        )
        assert response.status_code == 422
