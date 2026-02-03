"""Tests for alignment configuration domain model."""

import pytest
from pydantic import ValidationError

from src.backend.domain.alignment_config import (
    AlignmentConfig,
    AlignmentParams,
    STYLE_ADJUSTMENTS,
    lerp,
)


class TestLerp:
    """Tests for the lerp (linear interpolation) function."""

    def test_lerp_at_zero(self) -> None:
        """When t=0, returns start value."""
        assert lerp(0, 10, 0.0) == 0

    def test_lerp_at_one(self) -> None:
        """When t=1, returns end value."""
        assert lerp(0, 10, 1.0) == 10

    def test_lerp_at_midpoint(self) -> None:
        """When t=0.5, returns midpoint."""
        assert lerp(0, 10, 0.5) == 5

    def test_lerp_reversed_at_zero(self) -> None:
        """When t=0 with reversed range, returns start value."""
        assert lerp(20, 5, 0.0) == 20

    def test_lerp_reversed_at_one(self) -> None:
        """When t=1 with reversed range, returns end value."""
        assert lerp(20, 5, 1.0) == 5

    def test_lerp_reversed_at_midpoint(self) -> None:
        """When t=0.5 with reversed range, returns midpoint."""
        assert lerp(20, 5, 0.5) == 12.5

    def test_lerp_quarter(self) -> None:
        """When t=0.25, returns quarter point."""
        assert lerp(0, 100, 0.25) == 25

    def test_lerp_three_quarters(self) -> None:
        """When t=0.75, returns three-quarter point."""
        assert lerp(0, 100, 0.75) == 75

    def test_lerp_negative_range(self) -> None:
        """Lerp works with negative values."""
        assert lerp(-10, 10, 0.5) == 0
        assert lerp(-10, 10, 0.0) == -10
        assert lerp(-10, 10, 1.0) == 10

    def test_lerp_same_values(self) -> None:
        """Lerp returns same value when start equals end."""
        assert lerp(5, 5, 0.0) == 5
        assert lerp(5, 5, 0.5) == 5
        assert lerp(5, 5, 1.0) == 5


class TestAlignmentParams:
    """Tests for the AlignmentParams dataclass."""

    def test_create_params(self) -> None:
        """Test creating AlignmentParams with all values."""
        params = AlignmentParams(
            offset_padding_ms=15.0,
            cutoff_padding_ms=20.0,
            overlap_ratio=0.4,
            energy_threshold_ratio=0.1,
            consonant_vowel_extension_ratio=0.3,
            min_confidence_threshold=0.3,
        )
        assert params.offset_padding_ms == 15.0
        assert params.cutoff_padding_ms == 20.0
        assert params.overlap_ratio == 0.4
        assert params.energy_threshold_ratio == 0.1
        assert params.consonant_vowel_extension_ratio == 0.3
        assert params.min_confidence_threshold == 0.3

    def test_params_immutable(self) -> None:
        """AlignmentParams is frozen and cannot be modified."""
        params = AlignmentParams(
            offset_padding_ms=15.0,
            cutoff_padding_ms=20.0,
            overlap_ratio=0.4,
            energy_threshold_ratio=0.1,
            consonant_vowel_extension_ratio=0.3,
            min_confidence_threshold=0.3,
        )
        with pytest.raises(AttributeError):
            params.offset_padding_ms = 25.0  # type: ignore


class TestStyleAdjustments:
    """Tests for STYLE_ADJUSTMENTS constant."""

    def test_cv_adjustment(self) -> None:
        """CV style reduces overlap_ratio by 0.1."""
        assert "cv" in STYLE_ADJUSTMENTS
        assert STYLE_ADJUSTMENTS["cv"]["overlap_ratio"] == -0.1

    def test_vcv_adjustment(self) -> None:
        """VCV style increases overlap_ratio by 0.1."""
        assert "vcv" in STYLE_ADJUSTMENTS
        assert STYLE_ADJUSTMENTS["vcv"]["overlap_ratio"] == 0.1

    def test_cvvc_adjustment(self) -> None:
        """CVVC style increases overlap_ratio by 0.05."""
        assert "cvvc" in STYLE_ADJUSTMENTS
        assert STYLE_ADJUSTMENTS["cvvc"]["overlap_ratio"] == 0.05


class TestAlignmentConfigDefaults:
    """Tests for AlignmentConfig default values."""

    def test_default_tightness(self) -> None:
        """Default tightness is 0.5."""
        config = AlignmentConfig()
        assert config.tightness == 0.5

    def test_default_method_override(self) -> None:
        """Default method_override is None."""
        config = AlignmentConfig()
        assert config.method_override is None

    def test_default_params_values(self) -> None:
        """Default config (tightness=0.5) produces expected params."""
        config = AlignmentConfig()
        params = config.get_params()

        # At tightness=0.5, values should be midpoints
        # offset_padding: lerp(20, 5, 0.5) = 12.5
        assert params.offset_padding_ms == 12.5
        # cutoff_padding: lerp(30, 10, 0.5) = 20.0
        assert params.cutoff_padding_ms == 20.0
        # overlap_ratio: lerp(0.5, 0.3, 0.5) = 0.4
        assert params.overlap_ratio == 0.4
        # energy_threshold: lerp(0.08, 0.15, 0.5) = 0.115
        assert params.energy_threshold_ratio == pytest.approx(0.115)
        # cv_extension: lerp(0.4, 0.25, 0.5) = 0.325
        assert params.consonant_vowel_extension_ratio == pytest.approx(0.325)
        # min_confidence: lerp(0.2, 0.4, 0.5) = 0.3
        assert params.min_confidence_threshold == pytest.approx(0.3)


class TestTightnessBoundaryMapping:
    """Tests for tightness boundary value mapping."""

    def test_loose_tightness_params(self) -> None:
        """Tightness=0.0 (Loose) produces larger padding, lower thresholds."""
        config = AlignmentConfig(tightness=0.0)
        params = config.get_params()

        # Loose = more padding
        assert params.offset_padding_ms == 20.0
        assert params.cutoff_padding_ms == 30.0
        # Loose = higher overlap ratio
        assert params.overlap_ratio == 0.5
        # Loose = lower energy threshold
        assert params.energy_threshold_ratio == 0.08
        # Loose = higher CV extension
        assert params.consonant_vowel_extension_ratio == 0.4
        # Loose = lower confidence threshold
        assert params.min_confidence_threshold == 0.2

    def test_tight_tightness_params(self) -> None:
        """Tightness=1.0 (Tight) produces smaller padding, higher thresholds."""
        config = AlignmentConfig(tightness=1.0)
        params = config.get_params()

        # Tight = less padding
        assert params.offset_padding_ms == 5.0
        assert params.cutoff_padding_ms == 10.0
        # Tight = lower overlap ratio
        assert params.overlap_ratio == 0.3
        # Tight = higher energy threshold
        assert params.energy_threshold_ratio == 0.15
        # Tight = lower CV extension
        assert params.consonant_vowel_extension_ratio == 0.25
        # Tight = higher confidence threshold
        assert params.min_confidence_threshold == 0.4

    def test_quarter_tightness(self) -> None:
        """Tightness=0.25 interpolates correctly."""
        config = AlignmentConfig(tightness=0.25)
        params = config.get_params()

        # offset: lerp(20, 5, 0.25) = 16.25
        assert params.offset_padding_ms == 16.25
        # cutoff: lerp(30, 10, 0.25) = 25.0
        assert params.cutoff_padding_ms == 25.0

    def test_three_quarter_tightness(self) -> None:
        """Tightness=0.75 interpolates correctly."""
        config = AlignmentConfig(tightness=0.75)
        params = config.get_params()

        # offset: lerp(20, 5, 0.75) = 8.75
        assert params.offset_padding_ms == 8.75
        # cutoff: lerp(30, 10, 0.75) = 15.0
        assert params.cutoff_padding_ms == 15.0


class TestRecordingStyleAdjustments:
    """Tests for recording style adjustments to alignment params."""

    def test_cv_style_reduces_overlap(self) -> None:
        """CV style reduces overlap_ratio by 0.1."""
        config = AlignmentConfig(tightness=0.5)
        params = config.get_params(recording_style="cv")

        # Base overlap at 0.5 is 0.4, CV reduces by 0.1
        assert params.overlap_ratio == pytest.approx(0.3)

    def test_vcv_style_increases_overlap(self) -> None:
        """VCV style increases overlap_ratio by 0.1."""
        config = AlignmentConfig(tightness=0.5)
        params = config.get_params(recording_style="vcv")

        # Base overlap at 0.5 is 0.4, VCV increases by 0.1
        assert params.overlap_ratio == pytest.approx(0.5)

    def test_cvvc_style_increases_overlap(self) -> None:
        """CVVC style increases overlap_ratio by 0.05."""
        config = AlignmentConfig(tightness=0.5)
        params = config.get_params(recording_style="cvvc")

        # Base overlap at 0.5 is 0.4, CVVC increases by 0.05
        assert params.overlap_ratio == pytest.approx(0.45)

    def test_unknown_style_no_effect(self) -> None:
        """Unknown recording style has no effect on params."""
        config = AlignmentConfig(tightness=0.5)
        base_params = config.get_params()
        styled_params = config.get_params(recording_style="unknown_style")

        assert styled_params.overlap_ratio == base_params.overlap_ratio

    def test_style_case_insensitive(self) -> None:
        """Recording style is case-insensitive."""
        config = AlignmentConfig(tightness=0.5)

        lower = config.get_params(recording_style="vcv")
        upper = config.get_params(recording_style="VCV")
        mixed = config.get_params(recording_style="VcV")

        assert lower.overlap_ratio == upper.overlap_ratio == mixed.overlap_ratio

    def test_none_style_no_effect(self) -> None:
        """None recording style has no effect."""
        config = AlignmentConfig(tightness=0.5)
        base_params = config.get_params()
        none_params = config.get_params(recording_style=None)

        assert none_params.overlap_ratio == base_params.overlap_ratio

    def test_cv_at_loose_overlap_clamped(self) -> None:
        """CV at loose tightness doesn't produce negative overlap."""
        config = AlignmentConfig(tightness=0.0)  # overlap = 0.5
        params = config.get_params(recording_style="cv")  # -0.1 = 0.4

        # Should be 0.4, still positive
        assert params.overlap_ratio == 0.4

    def test_vcv_at_tight_overlap_clamped(self) -> None:
        """VCV at tight tightness doesn't exceed 1.0."""
        config = AlignmentConfig(tightness=1.0)  # overlap = 0.3
        params = config.get_params(recording_style="vcv")  # +0.1 = 0.4

        assert params.overlap_ratio == 0.4
        assert params.overlap_ratio <= 1.0

    def test_style_affects_only_overlap(self) -> None:
        """Style adjustments only affect overlap_ratio, not other params."""
        config = AlignmentConfig(tightness=0.5)
        base_params = config.get_params()
        cv_params = config.get_params(recording_style="cv")

        # All params except overlap should be the same
        assert cv_params.offset_padding_ms == base_params.offset_padding_ms
        assert cv_params.cutoff_padding_ms == base_params.cutoff_padding_ms
        assert cv_params.energy_threshold_ratio == base_params.energy_threshold_ratio
        assert (
            cv_params.consonant_vowel_extension_ratio
            == base_params.consonant_vowel_extension_ratio
        )
        assert (
            cv_params.min_confidence_threshold == base_params.min_confidence_threshold
        )

        # Only overlap should differ
        assert cv_params.overlap_ratio != base_params.overlap_ratio


class TestMethodOverrideValidation:
    """Tests for method_override validation."""

    def test_sofa_method_valid(self) -> None:
        """'sofa' is a valid method override."""
        config = AlignmentConfig(method_override="sofa")
        assert config.method_override == "sofa"

    def test_fa_method_valid(self) -> None:
        """'fa' is a valid method override."""
        config = AlignmentConfig(method_override="fa")
        assert config.method_override == "fa"

    def test_blind_method_valid(self) -> None:
        """'blind' is a valid method override."""
        config = AlignmentConfig(method_override="blind")
        assert config.method_override == "blind"

    def test_none_method_valid(self) -> None:
        """None is a valid method override."""
        config = AlignmentConfig(method_override=None)
        assert config.method_override is None

    def test_invalid_method_raises_error(self) -> None:
        """Invalid method override raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(method_override="invalid")

    def test_empty_string_method_raises_error(self) -> None:
        """Empty string method override raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(method_override="")

    def test_similar_but_invalid_method(self) -> None:
        """Similar but invalid method names raise ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(method_override="SOFA")  # Case matters

        with pytest.raises(ValidationError):
            AlignmentConfig(method_override="mfa")  # Close but wrong


class TestTightnessValidation:
    """Tests for tightness value validation."""

    def test_tightness_below_zero_raises_error(self) -> None:
        """Tightness below 0.0 raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(tightness=-0.1)

    def test_tightness_above_one_raises_error(self) -> None:
        """Tightness above 1.0 raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(tightness=1.1)

    def test_tightness_at_zero_valid(self) -> None:
        """Tightness exactly 0.0 is valid."""
        config = AlignmentConfig(tightness=0.0)
        assert config.tightness == 0.0

    def test_tightness_at_one_valid(self) -> None:
        """Tightness exactly 1.0 is valid."""
        config = AlignmentConfig(tightness=1.0)
        assert config.tightness == 1.0

    def test_tightness_just_below_zero(self) -> None:
        """Tightness just below 0.0 raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(tightness=-0.001)

    def test_tightness_just_above_one(self) -> None:
        """Tightness just above 1.0 raises ValidationError."""
        with pytest.raises(ValidationError):
            AlignmentConfig(tightness=1.001)

    def test_tightness_small_positive_valid(self) -> None:
        """Very small positive tightness is valid."""
        config = AlignmentConfig(tightness=0.001)
        assert config.tightness == 0.001

    def test_tightness_near_one_valid(self) -> None:
        """Tightness near 1.0 is valid."""
        config = AlignmentConfig(tightness=0.999)
        assert config.tightness == 0.999


class TestAlignmentConfigIntegration:
    """Integration tests combining multiple features."""

    def test_config_with_tightness_and_method(self) -> None:
        """Config can have both tightness and method_override."""
        config = AlignmentConfig(tightness=0.7, method_override="sofa")
        assert config.tightness == 0.7
        assert config.method_override == "sofa"

    def test_params_with_tightness_and_style(self) -> None:
        """Params correctly combine tightness and style adjustments."""
        config = AlignmentConfig(tightness=0.8)
        params = config.get_params(recording_style="vcv")

        # offset: lerp(20, 5, 0.8) = 8.0
        assert params.offset_padding_ms == 8.0
        # overlap: lerp(0.5, 0.3, 0.8) + 0.1 = 0.34 + 0.1 = 0.44
        assert params.overlap_ratio == pytest.approx(0.44)

    @pytest.mark.parametrize(
        "tightness,expected_offset",
        [
            (0.0, 20.0),
            (0.2, 17.0),
            (0.4, 14.0),
            (0.6, 11.0),
            (0.8, 8.0),
            (1.0, 5.0),
        ],
    )
    def test_tightness_offset_mapping(
        self, tightness: float, expected_offset: float
    ) -> None:
        """Verify offset_padding_ms at various tightness levels."""
        config = AlignmentConfig(tightness=tightness)
        params = config.get_params()
        assert params.offset_padding_ms == expected_offset

    @pytest.mark.parametrize(
        "style,expected_adjustment",
        [
            ("cv", -0.1),
            ("vcv", 0.1),
            ("cvvc", 0.05),
        ],
    )
    def test_style_overlap_adjustments(
        self, style: str, expected_adjustment: float
    ) -> None:
        """Verify overlap adjustments for each style."""
        config = AlignmentConfig(tightness=0.5)
        base_params = config.get_params()
        styled_params = config.get_params(recording_style=style)

        actual_adjustment = styled_params.overlap_ratio - base_params.overlap_ratio
        assert actual_adjustment == pytest.approx(expected_adjustment)
