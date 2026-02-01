"""Pydantic models for batch oto generation."""

from pydantic import BaseModel, Field

from src.backend.domain.oto_entry import OtoEntry


class BatchOtoRequest(BaseModel):
    """Request model for batch oto generation."""

    voicebank_id: str = Field(
        description="ID of the voicebank to process",
        min_length=1,
    )
    overwrite_existing: bool = Field(
        default=False,
        description="If True, replace existing entries. If False, skip files with entries.",
    )
    sofa_language: str = Field(
        default="ja",
        description="Language code for SOFA alignment (ja, en, zh, ko, fr). Defaults to Japanese.",
    )


class BatchOtoResult(BaseModel):
    """Result of batch oto generation.

    Contains generated entries, statistics, and information about any failures.
    """

    voicebank_id: str = Field(
        description="ID of the processed voicebank",
    )
    total_samples: int = Field(
        ge=0,
        description="Total number of WAV samples in the voicebank",
    )
    processed: int = Field(
        ge=0,
        description="Number of samples successfully processed",
    )
    skipped: int = Field(
        ge=0,
        description="Number of samples skipped (already had oto entries)",
    )
    failed: int = Field(
        ge=0,
        description="Number of samples that failed ML processing",
    )
    entries: list[OtoEntry] = Field(
        default_factory=list,
        description="Generated oto entries",
    )
    failed_files: list[str] = Field(
        default_factory=list,
        description="Filenames of samples that failed processing",
    )
    average_confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Average confidence score across all generated entries",
    )
