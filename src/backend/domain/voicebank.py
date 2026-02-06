"""Pydantic models for voicebank management."""

from datetime import datetime
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, Field

from src.backend.domain.utau import CharacterMetadata


class Language(str, Enum):
    """Supported voicebank languages."""

    JA = "ja"
    EN = "en"
    ZH = "zh"
    KO = "ko"


class RecordingStyle(str, Enum):
    """UTAU voicebank recording styles."""

    CV = "cv"
    VCV = "vcv"
    CVVC = "cvvc"
    VCCV = "vccv"
    ARPASING = "arpasing"


class VoicebankRelease(BaseModel):
    """Single release entry in voicebank version history.

    Tracks changes across voicebank versions for distribution and changelog purposes.
    """

    version: str = Field(description="Semantic version string (e.g., '1.0.0')")
    release_date: datetime | None = Field(
        default=None,
        description="When this version was released",
    )
    changelog: str | None = Field(
        default=None,
        description="Human-readable description of changes in this release",
    )
    distribution_format: str = Field(
        default="zip",
        description="Package format for distribution (zip, rar, 7z)",
    )


class VoicebankSummary(BaseModel):
    """Lightweight model for listing voicebanks.

    Used in list endpoints to avoid loading full voicebank details.
    """

    id: str = Field(description="Slugified unique identifier")
    name: str = Field(description="Human-readable display name")
    sample_count: int = Field(ge=0, description="Number of WAV sample files")
    has_oto: bool = Field(description="Whether oto.ini configuration exists")


class Voicebank(BaseModel):
    """Full voicebank details.

    Represents a folder containing WAV audio samples and optional
    oto.ini configuration for UTAU/OpenUTAU synthesis.
    """

    id: str = Field(description="Slugified unique identifier")
    name: str = Field(description="Human-readable display name")
    path: Path = Field(description="Absolute path to voicebank folder")
    sample_count: int = Field(ge=0, description="Number of WAV sample files")
    has_oto: bool = Field(description="Whether oto.ini configuration exists")
    created_at: datetime = Field(description="When the voicebank was created")
    language: Language | None = Field(
        default=None,
        description="Primary language of the voicebank (ja, en, zh, ko)",
    )
    recording_style: RecordingStyle | None = Field(
        default=None,
        description="Recording style (cv, vcv, cvvc, vccv, arpasing)",
    )
    encoding: str = Field(
        default="utf-8",
        description="Encoding for oto.ini file (utf-8 or cp932 for legacy UTAU)",
    )
    readme_content: str | None = Field(
        default=None,
        description="Content of the voicebank readme file",
    )
    character: CharacterMetadata | None = Field(
        default=None,
        description="Character metadata from character.txt",
    )
    version: str = Field(
        default="1.0.0",
        description="Current semantic version of the voicebank",
    )
    releases: list[VoicebankRelease] = Field(
        default_factory=list,
        description="Version history and release changelog",
    )

    model_config = {"from_attributes": True}

    def to_summary(self) -> VoicebankSummary:
        """Convert to lightweight summary model."""
        return VoicebankSummary(
            id=self.id,
            name=self.name,
            sample_count=self.sample_count,
            has_oto=self.has_oto,
        )


class VoicebankCreate(BaseModel):
    """Request model for creating a new voicebank."""

    name: str = Field(
        min_length=1,
        max_length=100,
        description="Display name for the voicebank",
    )
