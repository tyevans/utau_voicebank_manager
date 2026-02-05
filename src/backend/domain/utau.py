"""Pydantic models for UTAU-specific voicebank metadata.

Covers character.txt metadata, prefix.map pitch mapping,
phoneme inventory tracking, and per-sample quality metrics.
"""

from pydantic import BaseModel, Field, computed_field


class CharacterMetadata(BaseModel):
    """Metadata from a voicebank's character.txt file.

    character.txt ships with every UTAU voicebank and provides
    display information for the voice in the synthesizer UI.
    """

    name: str = Field(
        min_length=1,
        description="Display name of the voicebank character",
    )
    image: str | None = Field(
        default=None,
        description="Icon image filename (e.g., 'icon.bmp')",
    )
    sample: str | None = Field(
        default=None,
        description="Sample WAV filename for preview playback",
    )
    author: str | None = Field(
        default=None,
        description="Creator or distributor of the voicebank",
    )
    web: str | None = Field(
        default=None,
        description="Website URL for the voicebank or author",
    )
    version: str | None = Field(
        default=None,
        description="Version string of the voicebank release",
    )


class PrefixMapEntry(BaseModel):
    """A single pitch mapping in a prefix.map file.

    Each entry maps a musical pitch to a prefix/suffix pair that UTAU
    appends to phoneme aliases when rendering at that pitch. This allows
    voicebanks to use different recordings for different pitch ranges.
    """

    pitch: str = Field(
        min_length=1,
        description="Musical pitch name (e.g., 'C4', 'A3')",
    )
    prefix: str = Field(
        default="",
        description="Prefix prepended to the phoneme alias at this pitch",
    )
    suffix: str = Field(
        default="",
        description="Suffix appended to the phoneme alias at this pitch (more common than prefix)",
    )


class PrefixMap(BaseModel):
    """Collection of pitch-to-alias mappings from a prefix.map file.

    prefix.map tells UTAU which sample subdirectory or alias variant
    to use for each pitch, enabling multi-pitch voicebanks.
    """

    entries: list[PrefixMapEntry] = Field(
        default_factory=list,
        description="Ordered list of pitch mapping entries",
    )


class PhonemeInventory(BaseModel):
    """Tracks phoneme coverage for a voicebank.

    Compares the expected phoneme set for a given language and recording
    style against what has actually been recorded, providing coverage
    metrics and identifying gaps.
    """

    language: str = Field(
        min_length=1,
        description="Language code (e.g., 'ja', 'en', 'zh')",
    )
    style: str = Field(
        min_length=1,
        description="Recording style (e.g., 'CV', 'VCV', 'CVVC', 'VCCV', 'ARPAsing')",
    )
    expected_phonemes: list[str] = Field(
        description="Full set of phonemes expected for this language and style",
    )
    recorded_phonemes: list[str] = Field(
        default_factory=list,
        description="Phonemes that have been recorded so far",
    )

    @computed_field
    @property
    def coverage(self) -> float:
        """Fraction of expected phonemes that have been recorded (0.0 to 1.0)."""
        if not self.expected_phonemes:
            return 0.0
        recorded_set = set(self.recorded_phonemes)
        matched = sum(1 for p in self.expected_phonemes if p in recorded_set)
        return matched / len(self.expected_phonemes)

    @computed_field
    @property
    def missing_phonemes(self) -> list[str]:
        """Expected phonemes that have not yet been recorded."""
        recorded_set = set(self.recorded_phonemes)
        return [p for p in self.expected_phonemes if p not in recorded_set]


class SampleQualityMetrics(BaseModel):
    """Quality metrics for a single WAV sample file.

    Captures audio characteristics useful for flagging recording
    issues such as clipping, low volume, or excessive noise.
    """

    filename: str = Field(
        min_length=1,
        description="WAV filename (e.g., '_ka.wav')",
    )
    duration_ms: float = Field(
        ge=0,
        description="Total duration of the audio sample in milliseconds",
    )
    peak_amplitude: float = Field(
        ge=0.0,
        le=1.0,
        description="Peak absolute amplitude normalized to 0.0-1.0",
    )
    rms_db: float = Field(
        description="RMS loudness in decibels (typically negative)",
    )
    has_clipping: bool = Field(
        default=False,
        description="Whether the sample contains clipped audio (amplitude at or near 1.0)",
    )
    noise_floor_db: float | None = Field(
        default=None,
        description="Estimated noise floor in decibels, if measured",
    )
