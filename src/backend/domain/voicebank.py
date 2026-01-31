"""Pydantic models for voicebank management."""

from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field


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
