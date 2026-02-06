"""Parser utilities for custom recording list files.

Supports two common formats used in the UTAU community:

1. **Plain text**: One alias per line, optionally with comment headers.
   ```
   # k-row
   ka
   ki
   ku
   ke
   ko
   ```

2. **OREMO-style**: Tab-separated with filename hint and alias, optionally
   with additional metadata columns.
   ```
   _ka	ka
   _ki	ki
   _aku	a ku
   ```

Both formats support ``#`` and ``;`` comment lines and blank line skipping.
"""

import re

from src.backend.domain.recording_list import ReclistEntry

# Matches OREMO-style lines: filename<TAB>alias[<TAB>optional_comment]
# The alias group uses [^\t]* (not +) to also match empty alias columns.
_OREMO_PATTERN = re.compile(
    r"^(?P<filename>[^\t]+)\t(?P<alias>[^\t]*)(?:\t(?P<comment>.*))?$"
)

# Maximum entries to prevent abuse on uploads
MAX_RECLIST_ENTRIES = 10_000

# Maximum file size in bytes (1 MB)
MAX_RECLIST_FILE_SIZE = 1_048_576


class ReclistParseError(Exception):
    """Raised when a recording list file cannot be parsed."""


def detect_format(lines: list[str]) -> str:
    """Detect whether content is plain text or OREMO-style tab-separated.

    Heuristic: if any non-comment, non-blank line contains a tab character,
    the file is OREMO-style. Otherwise it is plain text.

    Args:
        lines: Lines from the recording list file.

    Returns:
        ``"oremo"`` if tab-separated format detected, ``"plain"`` otherwise.
    """
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        if "\t" in stripped:
            return "oremo"
    return "plain"


def _parse_plain_lines(lines: list[str]) -> tuple[list[ReclistEntry], list[str]]:
    """Parse plain-text recording list (one alias per line).

    Comment lines starting with ``#`` or ``;`` are treated as category
    headers: subsequent entries are assigned that category until a new
    header is encountered.

    Args:
        lines: Raw lines from the file.

    Returns:
        Tuple of (parsed entries, warning messages).
    """
    entries: list[ReclistEntry] = []
    warnings: list[str] = []
    current_category: str | None = None
    entry_index = 0

    for line_num, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()

        # Skip blank lines
        if not line:
            continue

        # Comment lines serve as category headers
        if line.startswith(("#", ";")):
            header = line.lstrip("#;").strip()
            if header:
                current_category = header
            continue

        # Validate: reject lines that are suspiciously long
        if len(line) > 200:
            warnings.append(f"Line {line_num}: skipped (exceeds 200 characters)")
            continue

        if entry_index >= MAX_RECLIST_ENTRIES:
            warnings.append(
                f"Line {line_num}: stopped parsing (maximum {MAX_RECLIST_ENTRIES} entries)"
            )
            break

        entries.append(
            ReclistEntry(
                alias=line,
                index=entry_index,
                category=current_category,
            )
        )
        entry_index += 1

    return entries, warnings


def _parse_oremo_lines(lines: list[str]) -> tuple[list[ReclistEntry], list[str]]:
    """Parse OREMO-style tab-separated recording list.

    Expected format per line: ``filename<TAB>alias[<TAB>comment]``

    Args:
        lines: Raw lines from the file.

    Returns:
        Tuple of (parsed entries, warning messages).
    """
    entries: list[ReclistEntry] = []
    warnings: list[str] = []
    current_category: str | None = None
    entry_index = 0

    for line_num, raw_line in enumerate(lines, start=1):
        # Strip spaces and newlines but preserve tabs for OREMO matching
        line = raw_line.strip(" \r\n")

        # Skip blank lines (a lone tab is effectively blank content)
        if not line or not line.strip():
            continue

        # Comment lines serve as category headers
        stripped = line.strip()
        if stripped.startswith(("#", ";")):
            header = stripped.lstrip("#;").strip()
            if header:
                current_category = header
            continue

        if entry_index >= MAX_RECLIST_ENTRIES:
            warnings.append(
                f"Line {line_num}: stopped parsing (maximum {MAX_RECLIST_ENTRIES} entries)"
            )
            break

        match = _OREMO_PATTERN.match(line)
        if match:
            alias = match.group("alias").strip()
            filename_hint = match.group("filename").strip()
            comment = match.group("comment")
            if comment:
                comment = comment.strip() or None

            if not alias:
                warnings.append(f"Line {line_num}: skipped (empty alias)")
                continue

            entries.append(
                ReclistEntry(
                    alias=alias,
                    filename_hint=filename_hint if filename_hint else None,
                    index=entry_index,
                    category=current_category,
                    comment=comment,
                )
            )
            entry_index += 1
        else:
            # Fallback: if no tab match, treat entire line as alias
            # (some OREMO lists have inconsistent formatting)
            if len(line) > 200:
                warnings.append(f"Line {line_num}: skipped (exceeds 200 characters)")
                continue

            entries.append(
                ReclistEntry(
                    alias=line,
                    index=entry_index,
                    category=current_category,
                )
            )
            entry_index += 1

    return entries, warnings


def parse_reclist(content: str) -> tuple[list[ReclistEntry], str, list[str]]:
    """Parse a recording list file from its text content.

    Auto-detects the format (plain text or OREMO-style) and parses
    all entries. Comment lines starting with ``#`` or ``;`` are
    used as category headers for subsequent entries.

    Args:
        content: Full text content of the recording list file.

    Returns:
        Tuple of (entries, detected_format, warnings).

    Raises:
        ReclistParseError: If the file is empty or contains no valid entries.
    """
    if not content or not content.strip():
        raise ReclistParseError("Recording list file is empty")

    lines = content.splitlines()
    detected_format = detect_format(lines)

    if detected_format == "oremo":
        entries, warnings = _parse_oremo_lines(lines)
    else:
        entries, warnings = _parse_plain_lines(lines)

    if not entries:
        raise ReclistParseError(
            "No valid entries found in recording list. "
            "Expected one alias per line (plain text) or "
            "tab-separated filename and alias (OREMO format)."
        )

    return entries, detected_format, warnings


def decode_reclist_bytes(data: bytes) -> str:
    """Decode recording list file bytes with automatic encoding detection.

    Tries common encodings used in the UTAU community (UTF-8, Shift-JIS,
    EUC-KR, GB2312) since recording lists come from many language communities.

    Args:
        data: Raw bytes from the uploaded file.

    Returns:
        Decoded string content.

    Raises:
        ReclistParseError: If file exceeds maximum size.
    """
    if len(data) > MAX_RECLIST_FILE_SIZE:
        raise ReclistParseError(
            f"File too large ({len(data)} bytes). "
            f"Maximum size is {MAX_RECLIST_FILE_SIZE} bytes (1 MB)."
        )

    # Try encodings commonly used across UTAU language communities
    encodings = [
        "utf-8-sig",  # UTF-8 with BOM (common on Windows)
        "utf-8",  # Modern standard
        "cp932",  # Japanese Shift-JIS
        "euc-kr",  # Korean
        "gb2312",  # Simplified Chinese
        "big5",  # Traditional Chinese
        "shift_jis",  # Fallback Japanese
    ]

    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue

    # Last resort: decode with replacement characters
    return data.decode("utf-8", errors="replace")
