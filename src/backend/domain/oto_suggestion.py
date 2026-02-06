"""Pydantic models for oto parameter suggestions."""

from pydantic import BaseModel, Field, model_validator

from src.backend.domain.oto_validation import OtoParams, clamp_oto_params
from src.backend.domain.phoneme import PhonemeSegment


class OtoSuggestion(BaseModel):
    """Suggested oto.ini parameters for a sample.

    Contains ML-suggested values for all oto parameters along with
    the detected phonemes used to generate the suggestions.

    Unlike OtoEntry which strictly rejects invalid cross-field relationships,
    OtoSuggestion clamps ML-generated values to valid ranges and records
    any corrections as validation_warnings.
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
    method_used: str = Field(
        default="defaults",
        description=(
            "Which alignment method produced the final result. "
            "One of: 'sofa', 'mms_fa', 'defaults'."
        ),
    )
    fallback_reasons: list[str] = Field(
        default_factory=list,
        description=(
            "Why each higher-priority alignment method was skipped or failed, "
            "in cascade order. Empty when the first method succeeded."
        ),
    )
    validation_warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Warnings from cross-field validation clamping. "
            "Non-empty when ML-generated values were adjusted to satisfy constraints."
        ),
    )

    @model_validator(mode="after")
    def clamp_cross_field_relationships(self) -> "OtoSuggestion":
        """Clamp parameters to valid ranges instead of rejecting.

        ML models may produce edge-case values that violate cross-field
        constraints (e.g., consonant < offset). Rather than raising a
        validation error, we clamp to the nearest valid value and record
        a warning for transparency.
        """
        params = OtoParams(
            offset=self.offset,
            consonant=self.consonant,
            cutoff=self.cutoff,
            preutterance=self.preutterance,
            overlap=self.overlap,
        )
        clamped, warnings = clamp_oto_params(params)

        if warnings:
            self.offset = clamped.offset
            self.consonant = clamped.consonant
            self.cutoff = clamped.cutoff
            self.preutterance = clamped.preutterance
            self.overlap = clamped.overlap
            self.validation_warnings = self.validation_warnings + warnings

        return self


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
