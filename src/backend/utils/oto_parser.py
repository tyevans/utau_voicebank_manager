"""Parser utilities for oto.ini files.

Oto.ini files define phoneme timing parameters for UTAU voicebanks.
These files are often encoded in Shift-JIS (Japanese Windows encoding)
but may also be UTF-8.
"""

import contextlib
import re
from pathlib import Path

from src.backend.domain.oto_entry import OtoEntry

# Regex pattern for parsing oto.ini lines
# Format: filename.wav=alias,offset,consonant,cutoff,preutterance,overlap
OTO_LINE_PATTERN = re.compile(
    r"^(?P<filename>[^=]+\.wav)=(?P<alias>[^,]*),(?P<offset>-?[\d.]+),"
    r"(?P<consonant>-?[\d.]+),(?P<cutoff>-?[\d.]+),(?P<preutterance>-?[\d.]+),"
    r"(?P<overlap>-?[\d.]+)\s*$",
    re.IGNORECASE,
)


def parse_oto_line(line: str) -> OtoEntry | None:
    """Parse a single oto.ini line into an OtoEntry.

    Args:
        line: A single line from an oto.ini file.

    Returns:
        OtoEntry if the line is valid, None if it's a comment, blank, or malformed.

    Examples:
        >>> entry = parse_oto_line("_ka.wav=- ka,45,120,-140,80,15")
        >>> entry.alias
        '- ka'
        >>> parse_oto_line("# comment")
        None
        >>> parse_oto_line("")
        None
    """
    # Strip whitespace
    line = line.strip()

    # Skip empty lines
    if not line:
        return None

    # Skip comment lines (various comment markers used in oto.ini files)
    if line.startswith(("#", ";", "//")):
        return None

    # Try to match the pattern
    match = OTO_LINE_PATTERN.match(line)
    if not match:
        return None

    try:
        filename = match.group("filename")
        alias = match.group("alias")

        # UTAU convention: if alias is empty, use filename without extension
        if not alias:
            alias = filename.rsplit(".", 1)[0] if "." in filename else filename

        return OtoEntry(
            filename=filename,
            alias=alias,
            offset=float(match.group("offset")),
            consonant=float(match.group("consonant")),
            cutoff=float(match.group("cutoff")),
            preutterance=float(match.group("preutterance")),
            overlap=float(match.group("overlap")),
        )
    except (ValueError, TypeError):
        # Validation failed (e.g., negative offset)
        return None


def parse_oto_file(content: str) -> list[OtoEntry]:
    """Parse entire oto.ini file content into a list of OtoEntry objects.

    Args:
        content: The full text content of an oto.ini file.

    Returns:
        List of successfully parsed OtoEntry objects.
        Invalid lines are silently skipped.

    Examples:
        >>> content = "_ka.wav=- ka,45,120,-140,80,15\\n_sa.wav=- sa,50,100,-120,70,10"
        >>> entries = parse_oto_file(content)
        >>> len(entries)
        2
    """
    entries: list[OtoEntry] = []

    for line in content.splitlines():
        entry = parse_oto_line(line)
        if entry is not None:
            entries.append(entry)

    return entries


def serialize_oto_entries(entries: list[OtoEntry]) -> str:
    """Serialize a list of OtoEntry objects back to oto.ini format.

    Args:
        entries: List of OtoEntry objects to serialize.

    Returns:
        String in oto.ini format with entries separated by newlines.

    Examples:
        >>> from src.backend.domain.oto_entry import OtoEntry
        >>> entries = [OtoEntry(filename="_ka.wav", alias="- ka", offset=45, consonant=120, cutoff=-140, preutterance=80, overlap=15)]
        >>> print(serialize_oto_entries(entries))
        _ka.wav=- ka,45,120,-140,80,15
    """
    return "\n".join(entry.to_oto_line() for entry in entries)


def read_oto_file(path: Path | str) -> list[OtoEntry]:
    """Read and parse an oto.ini file from disk.

    Handles common encodings used in UTAU voicebanks:
    - Shift-JIS (cp932) - Traditional Japanese Windows encoding
    - UTF-8 - Modern encoding
    - UTF-8 with BOM

    Args:
        path: Path to the oto.ini file.

    Returns:
        List of parsed OtoEntry objects.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        UnicodeDecodeError: If the file encoding cannot be determined.
    """
    path = Path(path)

    # Try different encodings commonly used in UTAU voicebanks
    encodings = ["utf-8-sig", "utf-8", "cp932", "shift_jis"]

    content: str | None = None
    for encoding in encodings:
        try:
            content = path.read_text(encoding=encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue

    if content is None:
        # Last resort: read with errors='replace' to handle any encoding
        content = path.read_text(encoding="utf-8", errors="replace")

    return parse_oto_file(content)


def write_oto_file(
    path: Path | str,
    entries: list[OtoEntry],
    encoding: str = "utf-8",
) -> None:
    """Write OtoEntry objects to an oto.ini file atomically.

    Writes to a temporary file first, then uses os.replace() to
    atomically move it to the final path. This prevents partial
    writes from corrupting the file if the process is interrupted.

    Args:
        path: Path where the oto.ini file should be written.
        entries: List of OtoEntry objects to write.
        encoding: File encoding (default: utf-8). Use 'cp932' for
                  compatibility with older UTAU versions.
    """
    import os
    import tempfile

    path = Path(path)
    content = serialize_oto_entries(entries)

    # Write to a temp file in the same directory (same filesystem),
    # then atomically replace the target. os.replace() is atomic on Linux.
    fd, tmp_path = tempfile.mkstemp(
        dir=path.parent,
        prefix=".oto_",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content + "\n")
        os.replace(tmp_path, path)
    except BaseException:
        # Clean up temp file on any failure
        with contextlib.suppress(OSError):
            os.unlink(tmp_path)
        raise


def decode_oto_bytes(data: bytes) -> str:
    """Decode oto.ini file bytes with automatic encoding detection.

    Useful when reading oto.ini from uploaded files or archives.

    Args:
        data: Raw bytes from an oto.ini file.

    Returns:
        Decoded string content.
    """
    # Try different encodings commonly used in UTAU voicebanks
    encodings = ["utf-8-sig", "utf-8", "cp932", "shift_jis"]

    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue

    # Last resort: decode with replacement characters
    return data.decode("utf-8", errors="replace")
