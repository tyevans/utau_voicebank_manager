"""Path traversal validation utilities for API endpoints.

Provides functions to reject filenames and identifiers that contain
path traversal sequences (e.g., '..', absolute paths, null bytes).
These are intended as early validation at the router layer, before
values reach service or repository code.
"""

import os
import re

from fastapi import HTTPException, status


def validate_path_component(value: str, *, label: str = "filename") -> None:
    """Validate that a string is safe to use as a single path component.

    Rejects values containing path traversal sequences, path separators,
    absolute path prefixes, or null bytes. Intended for user-supplied
    filenames, voicebank IDs, and similar identifiers that should never
    navigate outside their expected directory.

    Args:
        value: The string to validate (e.g., a filename or voicebank ID).
        label: Human-readable label for error messages (e.g., "filename",
            "voicebank_id").

    Raises:
        HTTPException 400: If the value contains unsafe path characters.
    """
    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must not be empty",
        )

    if ".." in value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must not contain '..'",
        )

    if value.startswith("/") or value.startswith("\\"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must not be an absolute path",
        )

    if os.sep in value or ("/" in value and os.sep != "/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must not contain path separators",
        )

    if "\x00" in value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: must not contain null bytes",
        )


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
_UNSAFE_FILENAME_CHARS_RE = re.compile(r"""[/\\\"'<>|:*?]""")
_MAX_FILENAME_LENGTH = 200


def sanitize_filename(name: str, *, fallback: str = "recording_session") -> str:
    """Sanitize a string for safe use as a download filename.

    Removes path traversal sequences, control characters, quotes, and other
    characters that are problematic in filenames across operating systems.
    Returns the fallback value if the sanitized result is empty.

    This is intended for constructing Content-Disposition filenames from
    user-provided names, not for validating untrusted input (use
    ``validate_path_component`` for that).

    Args:
        name: The raw name to sanitize.
        fallback: Value to use if sanitization produces an empty string.

    Returns:
        A filesystem-safe filename string (without extension).
    """
    # Remove control characters (0x00-0x1F, 0x7F)
    sanitized = _CONTROL_CHARS_RE.sub("", name)

    # Remove path traversal sequences
    sanitized = sanitized.replace("..", "")

    # Replace path separators and other unsafe chars with underscore
    sanitized = _UNSAFE_FILENAME_CHARS_RE.sub("_", sanitized)

    # Strip leading/trailing whitespace and dots (problematic on Windows)
    sanitized = sanitized.strip().strip(".")

    # Collapse runs of underscores
    sanitized = re.sub(r"_{2,}", "_", sanitized)

    # Truncate to max length
    sanitized = sanitized[:_MAX_FILENAME_LENGTH]

    # Strip again in case truncation left trailing whitespace/dots
    sanitized = sanitized.strip().strip(".")

    return sanitized if sanitized else fallback
