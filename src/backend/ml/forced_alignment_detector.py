"""Forced alignment phoneme detector using TorchAudio's MMS_FA model.

This module provides high-accuracy phoneme boundary detection for UTAU samples
by leveraging forced alignment. Unlike blind recognition, forced alignment
uses the known expected phonemes (extracted from filenames like _ka.wav)
to achieve much more accurate timing boundaries.

Uses torchaudio.pipelines.MMS_FA which is trained on 1100+ languages.

For UTAU voicebank samples (sustained vowels), this module uses a hybrid approach:
- Forced alignment: Detects phoneme onset positions with high precision
- Energy analysis: Extends vowel segments to capture sustained sounds

This hybrid approach addresses the limitation that CTC-based models only detect
short phoneme boundaries (typical of speech), while UTAU samples contain
sustained vowels lasting 1-3 seconds. Energy-based extension applies to ALL
vowel segments (not just the final one), which is critical for VCV samples
with repeated vowels like [a, k, a] where each vowel may be sustained.
"""

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import torch
import torchaudio
import torchaudio.functional as F

from src.backend.domain.alignment_config import AlignmentParams
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.ml.gpu_fallback import run_inference_with_cpu_fallback
from src.backend.utils.kana_romaji import contains_kana, kana_to_romaji

logger = logging.getLogger(__name__)

# Target sample rate for MMS_FA model (16kHz)
MMS_FA_SAMPLE_RATE = 16000

# Energy analysis parameters for extending segments
ENERGY_HOP_LENGTH = 256  # ~16ms at 16kHz

# Threshold ratios for energy-based boundary detection
# Attack threshold is lower to capture quiet consonants (m, n, h, f, s, etc.)
# Release threshold can be slightly higher as vowel endings are typically louder
ENERGY_ATTACK_THRESHOLD_RATIO = 0.03  # 3% above noise floor for onset detection
ENERGY_RELEASE_THRESHOLD_RATIO = 0.05  # 5% above noise floor for offset detection

# Hysteresis thresholds to prevent rapid on/off switching at boundary
# Once "on" (above on_threshold), require energy to drop below off_threshold to go "off"
ENERGY_HYSTERESIS_ON_RATIO = 0.03  # Threshold to turn "on" (start of sound)
ENERGY_HYSTERESIS_OFF_RATIO = 0.02  # Threshold to turn "off" (must drop lower)

# Minimum silence duration to treat as actual boundary (milliseconds)
# Brief dips shorter than this are ignored (merged as continuous sound)
MIN_SILENCE_DURATION_MS = 80.0  # 80ms - typical note sustain dips are shorter

# Legacy constant for backwards compatibility (not used internally)
ENERGY_THRESHOLD_RATIO = 0.03

# Padding values for energy boundaries
ENERGY_ONSET_PADDING_MS = (
    15.0  # Padding before detected onset to ensure consonant capture
)
ENERGY_END_PADDING_MS = 20.0  # Padding after energy drops

# Maximum allowed offset between FA onset and energy onset
# If FA detects phoneme much later than energy start, use energy start instead
MAX_FA_ENERGY_OFFSET_MS = 300.0

# Maximum allowed gap between consecutive segments
# If FA detects a segment much later than previous segment ends, adjust it
MAX_SEGMENT_GAP_MS = 200.0

# Cache directory for models
MODELS_DIR = Path(__file__).parent.parent.parent.parent / "models" / "torchaudio"


class ForcedAlignmentError(Exception):
    """Raised when forced alignment fails."""

    pass


class TranscriptExtractionError(Exception):
    """Raised when transcript cannot be extracted from filename."""

    pass


@dataclass
class TranscriptResult:
    """Result of extracting transcript from UTAU filename.

    Contains the clean phoneme transcript for alignment models, plus metadata
    flags indicating special UTAU sample types that may require different
    processing or should be skipped entirely.

    Attributes:
        transcript: Clean phonemes for alignment (space-separated romaji).
                   Empty string if the sample should be skipped.
        is_consonant_only: True if filename contained "子音" (shiin) suffix,
                          indicating a consonant-only sample without vowel.
        is_growl_variant: True if filename contained "゛" (standalone dakuten),
                         indicating a growl/power vocal variant.
        is_breath_sample: True if filename indicates a breath/inhale sample
                         (息, 吸, or similar markers).
        is_rest_marker: True if filename indicates a rest/silence marker
                       (R, ・, or similar).
        original_filename: The original filename before processing.
    """

    transcript: str
    is_consonant_only: bool = False
    is_growl_variant: bool = False
    is_breath_sample: bool = False
    is_rest_marker: bool = False
    original_filename: str = ""


# UTAU-specific notation markers to strip from filenames
# These are suffixes/markers that modify the sample type but aren't phonemes

# 子音 (shiin) = "consonant" - indicates consonant-only sample
UTAU_CONSONANT_ONLY_MARKER = "子音"

# Standalone dakuten (゛) at end indicates growl/power variant
# Note: This is different from combined dakuten in voiced kana like が
UTAU_GROWL_MARKER = "゛"

# Breath/inhale sample markers
UTAU_BREATH_MARKERS = frozenset(["息", "吸", "br", "breath"])

# Rest/silence markers
UTAU_REST_MARKERS = frozenset(["R", "・", "rest", "sil", "-"])


@lru_cache(maxsize=1)
def get_mms_fa_model() -> tuple[torch.nn.Module, dict[str, int]]:
    """Load and cache the MMS_FA forced alignment model.

    Uses LRU cache to ensure model is only loaded once per session.

    Returns:
        Tuple of (model, dictionary) where dictionary maps characters to token IDs

    Raises:
        ForcedAlignmentError: If model fails to load
    """
    logger.info("Loading MMS_FA forced alignment model")

    try:
        bundle = torchaudio.pipelines.MMS_FA

        # Get device
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # Load model without star token (we don't need it for simple alignment)
        model = bundle.get_model(with_star=False).to(device)
        model.eval()

        # Get dictionary mapping characters to token IDs
        # star=None means no star token in dictionary
        dictionary = bundle.get_dict(star=None)

        logger.info(f"MMS_FA model loaded successfully on {device}")
        return model, dictionary

    except Exception as e:
        logger.exception("Failed to load MMS_FA model")
        raise ForcedAlignmentError(f"Failed to load MMS_FA model: {e}") from e


def extract_transcript_from_filename(filename: str) -> str:
    """Extract expected transcript/phonemes from UTAU filename.

    UTAU sample files follow naming conventions like:
    - _ka.wav -> "ka"
    - _shi.wav -> "shi"
    - _tsu.wav -> "tsu"
    - _a_ka.wav -> "a ka" (VCV style)
    - あ.wav -> "a" (hiragana)
    - かきくけこ.wav -> "ka ki ku ke ko" (hiragana)

    Handles both romaji and Japanese kana (hiragana/katakana) filenames.
    Japanese kana is automatically converted to romaji for SOFA alignment.

    Also handles UTAU-specific notation markers:
    - 子音 (shiin): Consonant-only sample suffix, stripped
    - ゛ (standalone dakuten): Growl variant marker, stripped
    - 息, 吸: Breath sample markers

    Args:
        filename: The audio filename (with or without path)

    Returns:
        Extracted transcript text (space-separated romaji phonemes)

    Raises:
        TranscriptExtractionError: If transcript cannot be extracted

    Note:
        For richer metadata including sample type flags, use
        extract_transcript_with_metadata() instead.
    """
    result = extract_transcript_with_metadata(filename)
    return result.transcript


def extract_transcript_with_metadata(filename: str) -> TranscriptResult:
    """Extract transcript and metadata from UTAU filename.

    This is the full-featured version that returns sample type metadata
    in addition to the phoneme transcript. Use this when you need to know
    if a sample is a consonant-only, growl variant, breath sample, etc.

    UTAU sample files follow naming conventions like:
    - _ka.wav -> transcript="ka"
    - _shi.wav -> transcript="shi"
    - _a_ka.wav -> transcript="a ka" (VCV style)
    - あ.wav -> transcript="a" (hiragana)
    - か子音.wav -> transcript="ka", is_consonant_only=True
    - あ゛.wav -> transcript="a", is_growl_variant=True
    - 息.wav -> transcript="", is_breath_sample=True

    Args:
        filename: The audio filename (with or without path)

    Returns:
        TranscriptResult with transcript and metadata flags

    Raises:
        TranscriptExtractionError: If transcript cannot be extracted
            (except for special samples like breath/rest which return
            empty transcript with appropriate flag set)
    """
    original_filename = filename

    # Get just the filename without path
    name = Path(filename).stem

    # Initialize metadata flags
    is_consonant_only = False
    is_growl_variant = False
    is_breath_sample = False
    is_rest_marker = False

    # Remove leading underscore(s) common in UTAU files
    name = name.lstrip("_")

    # Remove any numeric prefix (like "01_ka" -> "ka")
    name = re.sub(r"^\d+[_-]?", "", name)

    # Check for breath sample markers (before other processing)
    name_lower = name.lower()
    if name in UTAU_BREATH_MARKERS or name_lower in UTAU_BREATH_MARKERS:
        return TranscriptResult(
            transcript="",
            is_breath_sample=True,
            original_filename=original_filename,
        )

    # Check for rest/silence markers
    if name in UTAU_REST_MARKERS or name_lower in UTAU_REST_MARKERS:
        return TranscriptResult(
            transcript="",
            is_rest_marker=True,
            original_filename=original_filename,
        )

    # Check for and strip UTAU-specific suffixes BEFORE kana conversion
    # Order matters: strip from right to left (outermost first)
    # Example: "か子音゛" -> strip ゛ first, then 子音, leaving "か"

    # Check for standalone ゛ (growl marker) at end FIRST
    # This handles cases like "か子音゛" where ゛ is the outermost suffix
    if name.endswith(UTAU_GROWL_MARKER):
        is_growl_variant = True
        name = name[: -len(UTAU_GROWL_MARKER)]
        logger.debug(f"Stripped ゛ growl marker from {original_filename}")

    # Check for 子音 (consonant-only) suffix AFTER growl marker
    if name.endswith(UTAU_CONSONANT_ONLY_MARKER):
        is_consonant_only = True
        name = name[: -len(UTAU_CONSONANT_ONLY_MARKER)]
        logger.debug(f"Stripped 子音 suffix from {original_filename}")

    # Handle special UTAU notation
    # - Remove breath marks and special characters (but not dakuten ゛ which was handled above)
    # Note: We keep ・ for now as it might be part of VCV patterns
    name = re.sub(r"[-。、]", "", name)

    # After stripping markers, check if anything meaningful remains
    if not name.strip():
        # The entire filename was markers (e.g., just "息" which was already handled)
        raise TranscriptExtractionError(
            f"Could not extract transcript from filename: {filename}"
        )

    # Check if name contains Japanese kana
    if contains_kana(name):
        # Convert kana to romaji (returns space-separated phonemes)
        name = kana_to_romaji(name)
    else:
        # Handle VCV-style names with underscores (a_ka -> a ka)
        # Replace underscores with spaces for romaji names
        name = name.replace("_", " ")
        # Convert to lowercase for consistency
        name = name.lower()

    # Clean up whitespace
    name = " ".join(name.split())

    # Final validation
    if not name:
        raise TranscriptExtractionError(
            f"Could not extract transcript from filename: {filename}"
        )

    return TranscriptResult(
        transcript=name,
        is_consonant_only=is_consonant_only,
        is_growl_variant=is_growl_variant,
        is_breath_sample=is_breath_sample,
        is_rest_marker=is_rest_marker,
        original_filename=original_filename,
    )


def preprocess_audio_for_alignment(
    file_path: Path,
    target_sr: int = MMS_FA_SAMPLE_RATE,
) -> tuple[torch.Tensor, int, float, np.ndarray]:
    """Load and preprocess audio for MMS_FA forced alignment.

    Args:
        file_path: Path to the audio file
        target_sr: Target sample rate (16kHz for MMS_FA)

    Returns:
        Tuple of (waveform_tensor, sample_rate, duration_ms, raw_audio)
        where raw_audio is the unnormalized numpy array for energy analysis

    Raises:
        ForcedAlignmentError: If audio cannot be processed
    """
    try:
        # Load audio with librosa for robust format handling
        audio, sr = librosa.load(str(file_path), sr=target_sr, mono=True)

        # Calculate duration in milliseconds
        duration_ms = (len(audio) / sr) * 1000

        # Keep raw audio for energy analysis
        raw_audio = audio.copy()

        # Normalize audio for model
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        # Convert to torch tensor with batch dimension [1, num_samples]
        waveform = torch.from_numpy(audio).float().unsqueeze(0)

        return waveform, sr, duration_ms, raw_audio

    except Exception as e:
        logger.exception(f"Failed to process audio file: {file_path}")
        raise ForcedAlignmentError(f"Failed to process audio: {e}") from e


def detect_energy_boundaries(
    audio: np.ndarray,
    sample_rate: int,
    hop_length: int = ENERGY_HOP_LENGTH,
    threshold_ratio: float = ENERGY_THRESHOLD_RATIO,
    attack_threshold_ratio: float | None = None,
    release_threshold_ratio: float | None = None,
    alignment_params: AlignmentParams | None = None,
    min_silence_duration_ms: float = MIN_SILENCE_DURATION_MS,
) -> tuple[float, float]:
    """Detect sound boundaries using RMS energy analysis with continuity detection.

    For UTAU voicebank samples with sustained vowels, this provides the actual
    sound duration that CTC-based alignment misses.

    Uses asymmetric thresholds for attack (onset) vs release (offset) detection:
    - Attack threshold is lower to capture quiet consonants (m, n, h, f, s)
    - Release threshold can be slightly higher as vowel endings are louder

    Includes continuity detection to prevent splitting notes at brief energy dips:
    - Uses hysteresis to prevent rapid on/off switching at threshold boundary
    - Merges adjacent sound regions if the gap is shorter than min_silence_duration_ms
    - This prevents sustained vowels with natural amplitude variation from being split

    Args:
        audio: Raw audio samples (numpy array)
        sample_rate: Audio sample rate
        hop_length: Hop length for RMS calculation
        threshold_ratio: Legacy parameter, used as fallback if attack/release
                        thresholds are not provided
        attack_threshold_ratio: Ratio above noise floor for onset detection.
                               Lower values capture quieter consonants.
                               Defaults to ENERGY_ATTACK_THRESHOLD_RATIO (0.03).
        release_threshold_ratio: Ratio above noise floor for offset detection.
                                Defaults to ENERGY_RELEASE_THRESHOLD_RATIO (0.05).
        alignment_params: Optional AlignmentParams for energy threshold.
                         If provided, overrides attack_threshold_ratio and
                         release_threshold_ratio with params.energy_threshold_ratio.
        min_silence_duration_ms: Minimum duration of silence (in ms) required to
                                treat as an actual boundary. Brief dips shorter
                                than this are merged as continuous sound.
                                Defaults to MIN_SILENCE_DURATION_MS (80ms).

    Returns:
        Tuple of (start_ms, end_ms) representing sound boundaries
    """
    # threshold_ratio is a legacy parameter kept for backwards compatibility
    _ = threshold_ratio

    # Use alignment_params if provided, otherwise fall back to explicit args or defaults
    if alignment_params is not None:
        # Use energy_threshold_ratio from params for both attack and release
        # (slightly adjusted for the asymmetric behavior)
        base_ratio = alignment_params.energy_threshold_ratio
        # Attack is typically more sensitive than release
        attack_threshold_ratio = (
            base_ratio * 0.6
            if attack_threshold_ratio is None
            else attack_threshold_ratio
        )
        release_threshold_ratio = (
            base_ratio if release_threshold_ratio is None else release_threshold_ratio
        )
    else:
        # Use specific thresholds or fall back to legacy/defaults
        if attack_threshold_ratio is None:
            attack_threshold_ratio = ENERGY_ATTACK_THRESHOLD_RATIO
        if release_threshold_ratio is None:
            release_threshold_ratio = ENERGY_RELEASE_THRESHOLD_RATIO

    # Calculate RMS energy
    rms = librosa.feature.rms(y=audio, hop_length=hop_length)[0]
    times = (
        librosa.frames_to_time(
            np.arange(len(rms)), sr=sample_rate, hop_length=hop_length
        )
        * 1000
    )

    if len(rms) == 0:
        return 0.0, len(audio) / sample_rate * 1000

    # Determine threshold using noise floor estimation
    noise_rms = np.percentile(rms, 10)  # Bottom 10% is likely silence
    signal_rms = np.percentile(rms, 90)  # Top 90% is likely signal

    # Calculate separate thresholds for attack (onset) and release (offset)
    # Attack threshold is lower to capture quiet consonants
    attack_threshold = noise_rms + (signal_rms - noise_rms) * attack_threshold_ratio
    release_threshold = noise_rms + (signal_rms - noise_rms) * release_threshold_ratio

    # Calculate hysteresis thresholds for continuity detection
    # Once sound is "on", it must drop below off_threshold to go "off"
    hysteresis_on = noise_rms + (signal_rms - noise_rms) * ENERGY_HYSTERESIS_ON_RATIO
    hysteresis_off = noise_rms + (signal_rms - noise_rms) * ENERGY_HYSTERESIS_OFF_RATIO

    # Find sound regions using hysteresis state machine
    # This prevents rapid on/off switching at threshold boundary
    sound_regions = _find_sound_regions_with_hysteresis(
        rms, times, hysteresis_on, hysteresis_off
    )

    if not sound_regions:
        # No sound detected, return full duration
        return 0.0, len(audio) / sample_rate * 1000

    # Merge adjacent regions if the gap is shorter than min_silence_duration_ms
    # This prevents splitting notes at brief energy dips during sustain
    merged_regions = _merge_adjacent_regions(sound_regions, min_silence_duration_ms)

    if not merged_regions:
        return 0.0, len(audio) / sample_rate * 1000

    # Use the first and last merged region for overall boundaries
    # For single continuous sounds, this will be one region spanning the whole note
    overall_start_ms = merged_regions[0][0]
    overall_end_ms = merged_regions[-1][1]

    # Now refine boundaries using attack/release thresholds for precision
    # Find onset: first frame above attack threshold within the overall region
    above_attack = rms > attack_threshold

    if not any(above_attack):
        # No sound detected with attack threshold, use hysteresis boundaries
        start_ms = max(0.0, overall_start_ms - ENERGY_ONSET_PADDING_MS)
        end_ms = overall_end_ms + ENERGY_END_PADDING_MS
        return start_ms, end_ms

    # Find first frame above attack threshold (sensitive to quiet consonants)
    first_frame = int(np.argmax(above_attack))

    # Find offset: last frame above release threshold
    above_release = rms > release_threshold
    if any(above_release):
        last_frame = len(rms) - 1 - int(np.argmax(above_release[::-1]))
    else:
        # Fall back to attack threshold if release threshold finds nothing
        last_frame = len(rms) - 1 - int(np.argmax(above_attack[::-1]))

    # Apply padding to ensure we don't clip the consonant
    # Subtract padding from start time (move earlier)
    start_ms = max(0.0, float(times[first_frame]) - ENERGY_ONSET_PADDING_MS)
    end_ms = float(times[last_frame]) + ENERGY_END_PADDING_MS

    return start_ms, end_ms


def _find_sound_regions_with_hysteresis(
    rms: np.ndarray,
    times: np.ndarray,
    on_threshold: float,
    off_threshold: float,
) -> list[tuple[float, float]]:
    """Find sound regions using hysteresis to prevent rapid on/off switching.

    Uses a state machine approach:
    - Start in "off" state
    - Transition to "on" when energy exceeds on_threshold
    - Stay "on" until energy drops below off_threshold
    - This prevents chattering at the threshold boundary

    Args:
        rms: RMS energy array
        times: Time array in milliseconds corresponding to RMS frames
        on_threshold: Energy threshold to transition from off to on
        off_threshold: Energy threshold to transition from on to off

    Returns:
        List of (start_ms, end_ms) tuples representing sound regions
    """
    regions: list[tuple[float, float]] = []
    is_on = False
    region_start_ms = 0.0

    for energy, time_ms in zip(rms, times, strict=True):
        if not is_on:
            # Currently off, check if we should turn on
            if energy > on_threshold:
                is_on = True
                region_start_ms = time_ms
        else:
            # Currently on, check if we should turn off
            if energy < off_threshold:
                is_on = False
                regions.append((region_start_ms, time_ms))

    # If still on at end, close the final region
    if is_on and len(times) > 0:
        regions.append((region_start_ms, float(times[-1])))

    return regions


def _merge_adjacent_regions(
    regions: list[tuple[float, float]],
    min_gap_ms: float,
) -> list[tuple[float, float]]:
    """Merge adjacent sound regions if the gap between them is too short.

    Brief energy dips during sustained notes should not create new boundaries.
    This function merges regions that are separated by less than min_gap_ms.

    Args:
        regions: List of (start_ms, end_ms) tuples representing sound regions
        min_gap_ms: Minimum gap duration to treat as actual silence

    Returns:
        List of merged (start_ms, end_ms) tuples
    """
    if not regions:
        return []

    merged: list[tuple[float, float]] = []
    current_start, current_end = regions[0]

    for next_start, next_end in regions[1:]:
        gap = next_start - current_end

        if gap < min_gap_ms:
            # Gap is too short, merge with current region
            # Extend current region to include the next one
            current_end = next_end
            logger.debug(
                f"Merging regions: gap of {gap:.1f}ms < {min_gap_ms:.1f}ms threshold"
            )
        else:
            # Gap is long enough, save current region and start new one
            merged.append((current_start, current_end))
            current_start, current_end = next_start, next_end

    # Don't forget the last region
    merged.append((current_start, current_end))

    return merged


# Vowel characters for energy-based segment extension.
# These correspond to the single-character romaji vowels that appear in transcripts
# after spaces are stripped. Vowels are the phonemes most likely to be sustained
# in UTAU samples, so they benefit from energy-based boundary extension.
VOWEL_CHARACTERS = frozenset("aeiou")


@dataclass
class EnergyProfile:
    """Frame-level energy profile for per-segment boundary analysis.

    Stores RMS energy values and their corresponding timestamps so that
    individual segment boundaries can be refined based on where energy
    actually drops below threshold.
    """

    rms: np.ndarray  # RMS energy per frame
    times_ms: np.ndarray  # Timestamp in ms per frame
    release_threshold: float  # Energy level below which sound is considered ended


def compute_energy_profile(
    audio: np.ndarray,
    sample_rate: int,
    hop_length: int = ENERGY_HOP_LENGTH,
    alignment_params: AlignmentParams | None = None,
) -> EnergyProfile:
    """Compute a frame-level energy profile for per-segment boundary analysis.

    This is used by _spans_to_segments to extend individual vowel segments
    based on where energy actually drops, rather than relying solely on
    the FA model's short CTC-style boundaries.

    Args:
        audio: Raw audio samples (numpy array, not normalized)
        sample_rate: Audio sample rate
        hop_length: Hop length for RMS calculation
        alignment_params: Optional alignment parameters for threshold tuning

    Returns:
        EnergyProfile with per-frame RMS, timestamps, and release threshold
    """
    rms = librosa.feature.rms(y=audio, hop_length=hop_length)[0]
    times_ms = (
        librosa.frames_to_time(
            np.arange(len(rms)), sr=sample_rate, hop_length=hop_length
        )
        * 1000
    )

    if len(rms) == 0:
        return EnergyProfile(
            rms=rms,
            times_ms=times_ms,
            release_threshold=0.0,
        )

    # Determine threshold using noise floor estimation (same logic as detect_energy_boundaries)
    noise_rms = np.percentile(rms, 10)
    signal_rms = np.percentile(rms, 90)

    if alignment_params is not None:
        release_ratio = alignment_params.energy_threshold_ratio
    else:
        release_ratio = ENERGY_RELEASE_THRESHOLD_RATIO

    release_threshold = noise_rms + (signal_rms - noise_rms) * release_ratio

    return EnergyProfile(
        rms=rms,
        times_ms=times_ms,
        release_threshold=release_threshold,
    )


def find_energy_end_in_region(
    energy_profile: EnergyProfile,
    region_start_ms: float,
    region_end_ms: float,
) -> float | None:
    """Find where energy drops below threshold within a time region.

    Scans the energy profile from region_start_ms forward and returns the
    timestamp where energy drops below the release threshold. If energy
    stays above threshold throughout the region, returns region_end_ms
    (the full available extent). If energy is already below threshold at
    region_start_ms, returns None (no extension warranted).

    Args:
        energy_profile: Pre-computed energy profile
        region_start_ms: Start of the region to scan (ms)
        region_end_ms: Maximum extent of the region (ms), typically
                      the start of the next segment

    Returns:
        The ms timestamp where energy drops below threshold, or
        region_end_ms if energy persists, or None if no energy found
    """
    rms = energy_profile.rms
    times = energy_profile.times_ms
    threshold = energy_profile.release_threshold

    if len(rms) == 0:
        return None

    # Find frames within the region
    region_mask = (times >= region_start_ms) & (times <= region_end_ms)
    region_indices = np.where(region_mask)[0]

    if len(region_indices) == 0:
        return None

    # Check if energy is above threshold at the start of the region
    first_idx = region_indices[0]
    if rms[first_idx] < threshold:
        # Energy already below threshold -- no extension warranted
        return None

    # Scan forward to find where energy drops below threshold
    for idx in region_indices:
        if rms[idx] < threshold:
            # Energy dropped -- return this timestamp plus small padding
            return float(times[idx]) + ENERGY_END_PADDING_MS

    # Energy stayed above threshold through the entire region
    return float(region_end_ms)


def tokenize_transcript(
    transcript: str,
    dictionary: dict[str, int],
) -> list[int]:
    """Convert transcript to token IDs for forced alignment.

    Args:
        transcript: Text transcript (characters)
        dictionary: Mapping from characters to token IDs

    Returns:
        List of token IDs

    Raises:
        ForcedAlignmentError: If characters are not in dictionary
    """
    tokens = []
    unknown_chars = []

    for char in transcript:
        if char in dictionary:
            tokens.append(dictionary[char])
        elif char == " ":
            # Skip spaces
            continue
        else:
            unknown_chars.append(char)

    if unknown_chars:
        # Log warning but continue with available characters
        logger.warning(
            f"Characters not in MMS_FA dictionary (skipped): {unknown_chars}"
        )

    if not tokens:
        raise ForcedAlignmentError(
            f"No valid tokens found in transcript: '{transcript}'"
        )

    return tokens


class ForcedAlignmentDetector:
    """Phoneme detector using TorchAudio's MMS_FA forced alignment.

    This detector achieves high accuracy by using known expected phonemes
    (from UTAU filename conventions) rather than blind recognition.
    The forced alignment approach aligns the audio to the expected
    character sequence, providing precise timing boundaries.

    Example usage:
        detector = ForcedAlignmentDetector()

        # Automatic transcript extraction from filename
        result = await detector.detect_phonemes(Path("_ka.wav"))

        # Or provide explicit transcript
        result = await detector.detect_phonemes_with_transcript(
            Path("audio.wav"),
            transcript="ka"
        )
    """

    def __init__(self) -> None:
        """Initialize the forced alignment detector."""
        self._model: torch.nn.Module | None = None
        self._dictionary: dict[str, int] | None = None

    def _ensure_model_loaded(self) -> tuple[torch.nn.Module, dict[str, int]]:
        """Ensure model is loaded, loading lazily if needed."""
        if self._model is None or self._dictionary is None:
            self._model, self._dictionary = get_mms_fa_model()
        return self._model, self._dictionary

    async def detect_phonemes(
        self,
        audio_path: Path,
        alignment_params: AlignmentParams | None = None,
    ) -> PhonemeDetectionResult:
        """Detect phonemes using forced alignment with auto-extracted transcript.

        Extracts the expected transcript from the UTAU filename convention
        and performs forced alignment.

        Args:
            audio_path: Path to the audio file (WAV recommended)
            alignment_params: Optional alignment parameters for energy threshold
                tuning. If provided, uses params.energy_threshold_ratio for
                silence/sound boundary detection.

        Returns:
            PhonemeDetectionResult containing aligned segments

        Raises:
            ForcedAlignmentError: If alignment fails
            TranscriptExtractionError: If transcript cannot be extracted
        """
        transcript = extract_transcript_from_filename(audio_path.name)
        return await self.detect_phonemes_with_transcript(
            audio_path, transcript, alignment_params=alignment_params
        )

    async def detect_phonemes_with_transcript(
        self,
        audio_path: Path,
        transcript: str,
        alignment_params: AlignmentParams | None = None,
    ) -> PhonemeDetectionResult:
        """Detect phonemes using forced alignment with provided transcript.

        Uses a hybrid approach for UTAU samples:
        1. Forced alignment detects phoneme onset positions
        2. Energy analysis extends ALL vowel segments to capture sustained sounds

        The energy extension applies to every vowel segment, not just the final
        one. This is critical for VCV samples with repeated vowels like [a, k, a]
        where each vowel may be sustained. Each vowel is extended up to where
        energy drops below threshold, capped at the next segment's start.

        Args:
            audio_path: Path to the audio file (WAV recommended)
            transcript: Expected text/phonemes in the audio
            alignment_params: Optional alignment parameters for energy threshold
                tuning. If provided, uses params.energy_threshold_ratio for
                silence/sound boundary detection.

        Returns:
            PhonemeDetectionResult containing aligned segments

        Raises:
            ForcedAlignmentError: If alignment fails
        """
        model, dictionary = self._ensure_model_loaded()
        device = next(model.parameters()).device

        # Load and preprocess audio
        waveform, sample_rate, duration_ms, raw_audio = preprocess_audio_for_alignment(
            audio_path
        )
        waveform = waveform.to(device)

        # Detect energy-based sound boundaries for global start/end
        energy_start_ms, energy_end_ms = detect_energy_boundaries(
            raw_audio, sample_rate, alignment_params=alignment_params
        )

        # Compute per-frame energy profile for per-segment extension
        energy_profile = compute_energy_profile(
            raw_audio, sample_rate, alignment_params=alignment_params
        )

        # Tokenize transcript
        tokens = tokenize_transcript(transcript, dictionary)

        def _gpu_inference() -> tuple[torch.Tensor, torch.Tensor, list]:
            with torch.inference_mode():
                emission, _ = model(waveform)
            targets = torch.tensor([tokens], dtype=torch.int32, device=device)
            alignments, scores = F.forced_align(emission, targets, blank=0)
            token_spans = F.merge_tokens(alignments[0], scores[0].exp())
            return emission, waveform, token_spans

        def _cpu_inference(
            cpu_tensors: dict[str, torch.Tensor],
        ) -> tuple[torch.Tensor, torch.Tensor, list]:
            cpu_waveform = cpu_tensors["waveform"]
            cpu_device = torch.device("cpu")
            with torch.inference_mode():
                emission, _ = model(cpu_waveform)
            targets = torch.tensor([tokens], dtype=torch.int32, device=cpu_device)
            alignments, scores = F.forced_align(emission, targets, blank=0)
            token_spans = F.merge_tokens(alignments[0], scores[0].exp())
            return emission, cpu_waveform, token_spans

        try:
            emission, used_waveform, token_spans = run_inference_with_cpu_fallback(
                model=model,
                inference_fn=_gpu_inference,
                tensors_to_move={"waveform": waveform},
                cpu_inference_fn=_cpu_inference,
                context="MMS_FA forced alignment",
            )

            # Convert to PhonemeSegments with energy-corrected boundaries
            segments = self._spans_to_segments(
                token_spans,
                transcript,
                used_waveform.size(1),
                emission.size(1),
                sample_rate,
                energy_start_ms=energy_start_ms,
                energy_end_ms=energy_end_ms,
                energy_profile=energy_profile,
            )

            return PhonemeDetectionResult(
                segments=segments,
                audio_duration_ms=duration_ms,
                model_name="torchaudio-mms-fa",
            )

        except Exception as e:
            logger.exception(f"Forced alignment failed for {audio_path}")
            raise ForcedAlignmentError(f"Forced alignment failed: {e}") from e

        finally:
            # Clean up GPU memory
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    async def batch_detect_phonemes(
        self,
        items: list[tuple[Path, str]],
        alignment_params: AlignmentParams | None = None,
    ) -> dict[Path, PhonemeDetectionResult]:
        """Detect phonemes for multiple audio files in batch.

        Pre-loads the model once, then processes each (audio_path, transcript)
        pair sequentially. Individual failures are logged and skipped.

        Args:
            items: List of (audio_path, transcript) pairs
            alignment_params: Optional alignment parameters for energy threshold
                tuning applied to all items.

        Returns:
            Dict mapping successful audio paths to their PhonemeDetectionResult

        Raises:
            ForcedAlignmentError: If ALL files fail alignment
        """
        if not items:
            return {}

        # Pre-load model once for entire batch
        self._ensure_model_loaded()

        results: dict[Path, PhonemeDetectionResult] = {}
        failed: list[tuple[Path, Exception]] = []

        for audio_path, transcript in items:
            try:
                result = await self.detect_phonemes_with_transcript(
                    audio_path, transcript, alignment_params=alignment_params
                )
                results[audio_path] = result
            except (ForcedAlignmentError, TranscriptExtractionError) as e:
                logger.warning(f"MMS_FA alignment failed for {audio_path.name}: {e}")
                failed.append((audio_path, e))

        # Log summary
        total = len(items)
        succeeded = len(results)
        failed_count = len(failed)
        logger.info(
            f"MMS_FA batch alignment: {succeeded} succeeded, "
            f"{failed_count} failed out of {total} files"
        )

        if not results and failed:
            raise ForcedAlignmentError(
                f"All {failed_count} files failed MMS_FA alignment. "
                f"First error: {failed[0][1]}"
            )

        return results

    def _spans_to_segments(
        self,
        token_spans: list,
        transcript: str,
        num_samples: int,
        num_frames: int,
        sample_rate: int,
        energy_start_ms: float | None = None,
        energy_end_ms: float | None = None,
        energy_profile: EnergyProfile | None = None,
    ) -> list[PhonemeSegment]:
        """Convert token spans to PhonemeSegment objects.

        For UTAU samples with sustained vowels:
        - First segment start is adjusted if FA detected it too late
        - ALL vowel segments are extended based on energy analysis

        Energy-based extension works as follows:
        - For non-final vowel segments: extend up to where energy drops below
          threshold, capped at the next segment's start time
        - For the final vowel segment: extend to the global energy_end_ms
        - Consonant segments are never extended (they have fixed durations)

        This is critical for VCV samples like [a, k, a] where the first 'a'
        may be sustained but the FA model only detects a short CTC boundary.

        Args:
            token_spans: List of TokenSpan objects from merge_tokens
            transcript: Original transcript text
            num_samples: Number of audio samples
            num_frames: Number of emission frames
            sample_rate: Audio sample rate
            energy_start_ms: Optional energy-detected sound start for adjusting
                            the first segment (when FA misdetects onset)
            energy_end_ms: Optional energy-detected sound end for extending
                          the final segment (for sustained vowels)
            energy_profile: Optional per-frame energy profile for extending
                           non-final vowel segments based on actual energy

        Returns:
            List of PhonemeSegment objects with timing in milliseconds
        """
        # Calculate frame duration
        # ratio = num_samples / num_frames gives samples per frame
        # samples_per_frame / sample_rate = seconds_per_frame
        ratio = num_samples / num_frames
        seconds_per_frame = ratio / sample_rate

        # Filter transcript to only valid characters (matching tokenization)
        # This ensures we have the right character for each span
        valid_chars = [c for c in transcript if c != " "]

        # First pass: compute raw FA timings for all spans so we know
        # each segment's start time (needed to cap extensions for earlier segments)
        raw_timings: list[tuple[str, float, float, float]] = []
        for i, span in enumerate(token_spans):
            phoneme = valid_chars[i] if i < len(valid_chars) else "?"
            start_ms = span.start * seconds_per_frame * 1000
            end_ms = span.end * seconds_per_frame * 1000
            confidence = float(span.score)
            raw_timings.append((phoneme, start_ms, end_ms, confidence))

        # Second pass: apply corrections with knowledge of all segment positions
        segments: list[PhonemeSegment] = []

        for i, (phoneme, start_ms, end_ms, confidence) in enumerate(raw_timings):
            is_first_segment = i == 0
            is_last_segment = i == len(raw_timings) - 1

            # For the first segment, check if FA detected it too late
            # This happens when the model struggles with certain vowels
            if is_first_segment and energy_start_ms is not None:
                offset = start_ms - energy_start_ms
                if offset > MAX_FA_ENERGY_OFFSET_MS:
                    # FA detected phoneme much later than sound start
                    # Use energy-detected start instead
                    logger.debug(
                        f"FA start ({start_ms:.1f}ms) is {offset:.1f}ms after "
                        f"energy start ({energy_start_ms:.1f}ms), using energy start"
                    )
                    start_ms = energy_start_ms

            # For non-first segments, check for unreasonable gaps
            if not is_first_segment and len(segments) > 0:
                prev_segment = segments[-1]
                gap = start_ms - prev_segment.end_ms
                if gap > MAX_SEGMENT_GAP_MS:
                    # Gap is too large, assume phoneme should follow previous
                    adjusted_start = (
                        prev_segment.end_ms + 10
                    )  # Small gap for transition
                    logger.debug(
                        f"Gap ({gap:.1f}ms) after '{prev_segment.phoneme}' is too large, "
                        f"adjusting '{phoneme}' start from {start_ms:.1f}ms to {adjusted_start:.1f}ms"
                    )
                    start_ms = adjusted_start

            # Energy-based vowel extension
            is_vowel = phoneme.lower() in VOWEL_CHARACTERS

            if is_last_segment and energy_end_ms is not None:
                # Final segment: extend to global energy-detected sound end
                # (applies to any final phoneme, vowel or not, preserving
                # original behavior)
                end_ms = max(end_ms, energy_end_ms)

            elif is_vowel and not is_last_segment and energy_profile is not None:
                # Non-final vowel: use energy profile to find actual sustain end
                # Cap extension at the next segment's raw FA start time so we
                # don't encroach into the next phoneme's territory
                next_start_ms = raw_timings[i + 1][1]
                # Also respect any gap-adjusted start that might apply to the
                # next segment. Use the raw FA start as the hard cap since gap
                # adjustment only moves starts earlier, not later.
                cap_ms = next_start_ms

                energy_end = find_energy_end_in_region(
                    energy_profile,
                    region_start_ms=end_ms,
                    region_end_ms=cap_ms,
                )

                if energy_end is not None and energy_end > end_ms:
                    logger.debug(
                        f"Extending vowel '{phoneme}' (segment {i}) end from "
                        f"{end_ms:.1f}ms to {energy_end:.1f}ms "
                        f"(capped at next segment start {cap_ms:.1f}ms)"
                    )
                    # Ensure we don't exceed the cap even with padding
                    end_ms = min(energy_end, cap_ms)

            # Score is already a probability (0-1) from exp()
            segments.append(
                PhonemeSegment(
                    phoneme=phoneme,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    confidence=confidence,
                )
            )

        return segments


# Module-level singleton for convenience
_default_detector: ForcedAlignmentDetector | None = None


def get_forced_alignment_detector() -> ForcedAlignmentDetector:
    """Get the default forced alignment detector singleton.

    Returns:
        ForcedAlignmentDetector instance
    """
    global _default_detector
    if _default_detector is None:
        _default_detector = ForcedAlignmentDetector()
    return _default_detector


async def detect_phonemes_forced(
    audio_path: Path,
    transcript: str | None = None,
) -> PhonemeDetectionResult:
    """Convenience function for forced alignment phoneme detection.

    Args:
        audio_path: Path to audio file
        transcript: Optional transcript. If None, extracted from filename.

    Returns:
        PhonemeDetectionResult with aligned segments
    """
    detector = get_forced_alignment_detector()

    if transcript is not None:
        return await detector.detect_phonemes_with_transcript(audio_path, transcript)
    else:
        return await detector.detect_phonemes(audio_path)
