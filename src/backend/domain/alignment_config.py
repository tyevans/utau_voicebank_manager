"""Domain models for alignment configuration.

Provides a simple user-facing tightness control that maps to internal
alignment parameters via linear interpolation.
"""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation between a and b.

    Args:
        a: Start value (when t=0)
        b: End value (when t=1)
        t: Interpolation factor (0.0 to 1.0)

    Returns:
        Interpolated value between a and b
    """
    return a + (b - a) * t


# Style-specific adjustments applied on top of tightness-derived params
STYLE_ADJUSTMENTS: dict[str, dict[str, float]] = {
    "cv": {"overlap_ratio": -0.1},
    "vcv": {"overlap_ratio": +0.1},
    "cvvc": {"overlap_ratio": +0.05},
}


@dataclass(frozen=True)
class AlignmentParams:
    """Internal alignment parameters derived from tightness.

    These are the actual values used by the alignment algorithms.
    Users don't interact with these directly - they're computed
    from the tightness setting.
    """

    offset_padding_ms: float
    """Padding before detected phoneme start (ms)"""

    cutoff_padding_ms: float
    """Padding after detected phoneme end (ms)"""

    overlap_ratio: float
    """Ratio of preutterance used for overlap (0.0 to 1.0)"""

    energy_threshold_ratio: float
    """Threshold for energy-based silence detection (0.0 to 1.0)"""

    consonant_vowel_extension_ratio: float
    """How much consonant extends into vowel region (0.0 to 1.0)"""

    min_confidence_threshold: float
    """Minimum confidence to accept ML predictions (0.0 to 1.0)"""


class AlignmentConfig(BaseModel):
    """User-facing alignment configuration.

    Provides one simple control (tightness) that maps to multiple
    internal parameters. Tightness controls the trade-off between
    forgiving/padded alignment and precise/tight alignment.

    Examples:
        >>> config = AlignmentConfig(tightness=0.5)
        >>> params = config.get_params()
        >>> params.offset_padding_ms
        12.5

        >>> config = AlignmentConfig(tightness=1.0)
        >>> params = config.get_params(recording_style="vcv")
        >>> params.overlap_ratio
        0.4  # 0.3 base + 0.1 VCV adjustment
    """

    tightness: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description=(
            "Alignment tightness (0.0 to 1.0). "
            "0.0 = loose/forgiving with more padding, "
            "1.0 = tight/precise with minimal padding. "
            "Default 0.5 provides balanced results."
        ),
    )

    method_override: Literal["sofa", "fa", "blind"] | None = Field(
        default=None,
        description=(
            "Override automatic alignment method selection. "
            "None = auto-select best method, "
            "'sofa' = SOFA neural aligner, "
            "'fa' = Montreal Forced Aligner, "
            "'blind' = energy-based without ML. "
            "Most users should leave this as None."
        ),
    )

    def get_params(self, recording_style: str | None = None) -> AlignmentParams:
        """Convert tightness to internal alignment parameters.

        Args:
            recording_style: Optional recording style (cv, vcv, cvvc) for
                style-specific adjustments. Case-insensitive.

        Returns:
            AlignmentParams with values interpolated from tightness
            and adjusted for recording style if provided.
        """
        t = self.tightness

        # Base parameters from tightness via lerp
        # Loose (t=0) -> Tight (t=1)
        offset_padding_ms = lerp(20, 5, t)
        cutoff_padding_ms = lerp(30, 10, t)
        overlap_ratio = lerp(0.5, 0.3, t)
        energy_threshold_ratio = lerp(0.08, 0.15, t)
        consonant_vowel_extension_ratio = lerp(0.4, 0.25, t)
        min_confidence_threshold = lerp(0.2, 0.4, t)

        # Apply style-specific adjustments
        if recording_style:
            style_key = recording_style.lower()
            if style_key in STYLE_ADJUSTMENTS:
                adjustments = STYLE_ADJUSTMENTS[style_key]
                if "overlap_ratio" in adjustments:
                    overlap_ratio += adjustments["overlap_ratio"]
                    # Clamp to valid range
                    overlap_ratio = max(0.0, min(1.0, overlap_ratio))

        return AlignmentParams(
            offset_padding_ms=offset_padding_ms,
            cutoff_padding_ms=cutoff_padding_ms,
            overlap_ratio=overlap_ratio,
            energy_threshold_ratio=energy_threshold_ratio,
            consonant_vowel_extension_ratio=consonant_vowel_extension_ratio,
            min_confidence_threshold=min_confidence_threshold,
        )
