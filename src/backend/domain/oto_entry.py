"""Pydantic model for oto.ini entries."""

from pydantic import BaseModel, Field, field_validator, model_validator

from src.backend.domain.oto_validation import (
    OtoParams,
    check_oto_warnings,
    validate_oto_strict,
)


class OtoEntry(BaseModel):
    """Single entry in an oto.ini file.

    Represents one phoneme alias configuration for a WAV sample.
    Multiple entries can reference the same WAV file with different aliases.

    Oto.ini line format:
        filename.wav=alias,offset,consonant,cutoff,preutterance,overlap
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
        description="Playback start position in milliseconds (positive)",
    )
    consonant: float = Field(
        ge=0,
        description="Fixed region end - portion not stretched during synthesis (ms)",
    )
    cutoff: float = Field(
        description="Playback end position in ms. Negative = from audio end, positive = from start",
    )
    preutterance: float = Field(
        ge=0,
        description="How early to start before the note begins (ms)",
    )
    overlap: float = Field(
        description="Crossfade duration with previous note (ms). Negative values create gaps.",
    )

    @field_validator("filename")
    @classmethod
    def filename_must_be_wav(cls, v: str) -> str:
        """Validate that filename ends with .wav (case-insensitive)."""
        if not v.lower().endswith(".wav"):
            raise ValueError("Filename must end with .wav")
        return v

    @model_validator(mode="after")
    def validate_cross_field_relationships(self) -> "OtoEntry":
        """Validate relationships between fields that are always invalid.

        Only rejects configurations that are physically impossible --
        the consonant marker before playback starts, or the note alignment
        point before playback starts. UTAU power users may have unusual
        but valid configs, so we keep this conservative.
        """
        validate_oto_strict(self._to_params())
        return self

    def check_relationships(self) -> list[str]:
        """Return warnings for unusual-but-valid field relationships.

        These are soft checks the API or UI can surface to the user
        without rejecting the entry. An empty list means no warnings.
        """
        return check_oto_warnings(self._to_params())

    def _to_params(self) -> OtoParams:
        """Extract numeric parameters for shared validation."""
        return OtoParams(
            offset=self.offset,
            consonant=self.consonant,
            cutoff=self.cutoff,
            preutterance=self.preutterance,
            overlap=self.overlap,
        )

    def to_oto_line(self) -> str:
        """Serialize this entry back to oto.ini line format.

        Returns:
            String in format: filename.wav=alias,offset,consonant,cutoff,preutterance,overlap
        """

        # Format numeric values - use integers if they're whole numbers
        def fmt(val: float) -> str:
            if val == int(val):
                return str(int(val))
            return str(val)

        return (
            f"{self.filename}={self.alias},"
            f"{fmt(self.offset)},{fmt(self.consonant)},{fmt(self.cutoff)},"
            f"{fmt(self.preutterance)},{fmt(self.overlap)}"
        )

    def __str__(self) -> str:
        """String representation as oto.ini line."""
        return self.to_oto_line()
