"""Pydantic models for custom recording lists.

Custom recording lists allow users to import recording scripts for
languages or styles not built into the platform. They support plain
text (one alias per line) and OREMO-style (tab-separated with metadata)
formats commonly used in the UTAU community.
"""

from typing import Literal

from pydantic import BaseModel, Field, computed_field


class ReclistEntry(BaseModel):
    """A single entry parsed from a recording list file.

    Represents one line to be recorded, with the alias text and
    optional metadata extracted from the source file.
    """

    alias: str = Field(
        description="Phoneme alias to record (e.g., 'ka', 'a ka', 'k ae')",
        min_length=1,
    )
    filename_hint: str | None = Field(
        default=None,
        description="Suggested WAV filename from OREMO metadata (without extension)",
    )
    index: int = Field(
        ge=0,
        description="Zero-based position in the original recording list",
    )
    category: str | None = Field(
        default=None,
        description="Optional grouping category from OREMO metadata or comment headers",
    )
    comment: str | None = Field(
        default=None,
        description="Optional comment or note from the source file",
    )


class RecordingList(BaseModel):
    """A custom recording list imported from a user-supplied text file.

    Contains parsed entries ready for use in a recording session,
    along with metadata about the source file and detected format.
    """

    name: str = Field(
        description="User-assigned name for this recording list",
        min_length=1,
        max_length=100,
    )
    language: str = Field(
        default="other",
        description="ISO 639-1 language code or 'other' for unspecified",
        max_length=10,
    )
    style: str = Field(
        default="custom",
        description="Recording style (cv, vcv, cvvc, vccv, arpasing, or custom)",
        max_length=20,
    )
    format_detected: Literal["plain", "oremo"] = Field(
        description="Format auto-detected from the uploaded file",
    )
    entries: list[ReclistEntry] = Field(
        description="Parsed recording list entries",
        min_length=1,
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal issues encountered during parsing (e.g., skipped lines)",
    )

    @computed_field
    @property
    def total_entries(self) -> int:
        """Total number of recording entries."""
        return len(self.entries)

    @computed_field
    @property
    def categories(self) -> list[str]:
        """Unique categories found in the recording list."""
        return sorted({e.category for e in self.entries if e.category is not None})

    @computed_field
    @property
    def prompts(self) -> list[str]:
        """Alias texts suitable for use as recording session prompts."""
        return [e.alias for e in self.entries]


class ReclistParseRequest(BaseModel):
    """Request metadata for parsing a recording list file.

    Sent alongside the uploaded file to provide context about the
    recording list being imported.
    """

    name: str = Field(
        description="Name for this recording list",
        min_length=1,
        max_length=100,
    )
    language: str = Field(
        default="other",
        description="ISO 639-1 language code or 'other'",
        max_length=10,
    )
    style: str = Field(
        default="custom",
        description="Recording style (cv, vcv, cvvc, vccv, arpasing, or custom)",
        max_length=20,
    )
