"""Pydantic models for voicebank generation results."""

from pathlib import Path

from pydantic import BaseModel, Field


class GenerateVoicebankRequest(BaseModel):
    """Request model for voicebank generation from a recording session."""

    voicebank_name: str = Field(
        min_length=1,
        max_length=100,
        description="Display name for the generated voicebank",
    )
    output_path: str | None = Field(
        default=None,
        description="Optional custom output path for the voicebank",
    )
    include_character_txt: bool = Field(
        default=True,
        description="Whether to include character.txt metadata file",
    )
    encoding: str = Field(
        default="utf-8",
        description="Encoding for oto.ini file (utf-8 or cp932 for legacy UTAU)",
    )


class GeneratedVoicebank(BaseModel):
    """Result of voicebank generation from a recording session.

    Contains the generated voicebank location and statistics about
    the generation process.
    """

    name: str = Field(
        description="Display name of the generated voicebank",
    )
    path: Path = Field(
        description="Absolute path to the generated voicebank folder",
    )
    sample_count: int = Field(
        ge=0,
        description="Number of audio sample files generated",
    )
    oto_entries: int = Field(
        ge=0,
        description="Number of oto.ini entries created",
    )
    recording_style: str = Field(
        description="Recording style (cv, vcv, cvvc, etc.)",
    )
    language: str = Field(
        description="Language code (ja, en, etc.)",
    )
    generation_time_seconds: float = Field(
        ge=0,
        description="Time taken to generate the voicebank in seconds",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal warnings encountered during generation",
    )
    skipped_segments: int = Field(
        default=0,
        ge=0,
        description="Number of segments skipped due to errors",
    )
    average_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Average confidence score of oto parameter suggestions",
    )


class SlicedSample(BaseModel):
    """A sliced audio sample with its oto parameters.

    Represents a single phoneme sample extracted from a recording segment.
    """

    filename: str = Field(
        description="Output WAV filename (e.g., '_ka.wav', '_aka.wav')",
    )
    alias: str = Field(
        description="Phoneme alias for oto.ini (e.g., '- ka', 'a ka')",
    )
    source_segment_id: str = Field(
        description="UUID of the source recording segment",
    )
    phoneme: str = Field(
        description="Phoneme identifier",
    )
    start_ms: float = Field(
        ge=0,
        description="Start time in source audio (ms)",
    )
    end_ms: float = Field(
        ge=0,
        description="End time in source audio (ms)",
    )
    duration_ms: float = Field(
        ge=0,
        description="Duration of the sample (ms)",
    )
