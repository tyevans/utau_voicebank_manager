"""Pydantic models for oto parameter suggestions."""

from pydantic import BaseModel, Field

from src.backend.domain.phoneme import PhonemeSegment


class OtoSuggestion(BaseModel):
    """Suggested oto.ini parameters for a sample.

    Contains ML-suggested values for all oto parameters along with
    the detected phonemes used to generate the suggestions.
    """

    filename: str = Field(
        description="WAV filename (e.g., '_ka.wav')",
        min_length=1,
    )
    alias: str = Field(
        description="Phoneme alias (e.g., '- ka' for CV, 'a ka' for VCV)",
    )
    offset: float = Field(
        ge=0,
        description="Suggested playback start position in milliseconds",
    )
    consonant: float = Field(
        ge=0,
        description="Suggested fixed region end in milliseconds",
    )
    cutoff: float = Field(
        description="Suggested playback end position (negative = from audio end)",
    )
    preutterance: float = Field(
        ge=0,
        description="Suggested preutterance value in milliseconds",
    )
    overlap: float = Field(
        ge=0,
        description="Suggested overlap/crossfade duration in milliseconds",
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Overall confidence in the suggestion (0-1)",
    )
    phonemes_detected: list[PhonemeSegment] = Field(
        default_factory=list,
        description="Phonemes detected in the audio (for transparency/debugging)",
    )
    audio_duration_ms: float = Field(
        ge=0,
        description="Total audio duration in milliseconds",
    )


class OtoSuggestionRequest(BaseModel):
    """Request parameters for oto suggestion."""

    voicebank_id: str = Field(
        description="ID of the voicebank containing the sample",
    )
    filename: str = Field(
        description="Filename of the sample within the voicebank",
    )
    alias: str | None = Field(
        default=None,
        description="Optional alias override (auto-generated from filename if not provided)",
    )
