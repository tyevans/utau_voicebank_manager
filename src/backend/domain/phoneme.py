"""Pydantic models for phoneme detection results."""

from pydantic import BaseModel, ConfigDict, Field


class PhonemeSegment(BaseModel):
    """A detected phoneme with timing and confidence information.

    Represents a single phoneme detected in an audio file, including
    its temporal boundaries and the model's confidence in the detection.
    """

    phoneme: str = Field(
        description="Phoneme symbol (IPA or ARPABET format depending on model)",
        min_length=1,
    )
    start_ms: float = Field(
        ge=0,
        description="Start time of the phoneme in milliseconds",
    )
    end_ms: float = Field(
        ge=0,
        description="End time of the phoneme in milliseconds",
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Detection confidence score between 0 and 1",
    )

    @property
    def duration_ms(self) -> float:
        """Duration of the phoneme in milliseconds."""
        return self.end_ms - self.start_ms


class PhonemeDetectionResult(BaseModel):
    """Result of phoneme detection on an audio file."""

    # Allow 'model_name' field despite Pydantic's protected namespace
    model_config = ConfigDict(protected_namespaces=())

    segments: list[PhonemeSegment] = Field(
        default_factory=list,
        description="List of detected phoneme segments",
    )
    audio_duration_ms: float = Field(
        ge=0,
        description="Total duration of the analyzed audio in milliseconds",
    )
    model_name: str = Field(
        description="Name of the model used for detection",
    )

    @property
    def phoneme_count(self) -> int:
        """Number of detected phonemes."""
        return len(self.segments)
