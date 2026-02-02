"""Forced alignment phoneme detector using TorchAudio's MMS_FA model.

This module provides high-accuracy phoneme boundary detection for UTAU samples
by leveraging forced alignment. Unlike blind recognition, forced alignment
uses the known expected phonemes (extracted from filenames like _ka.wav)
to achieve much more accurate timing boundaries.

Uses torchaudio.pipelines.MMS_FA which is trained on 1100+ languages.

For UTAU voicebank samples (sustained vowels), this module uses a hybrid approach:
- Forced alignment: Detects phoneme onset positions with high precision
- Energy analysis: Extends the final segment to capture sustained sounds

This hybrid approach addresses the limitation that CTC-based models only detect
short phoneme boundaries (typical of speech), while UTAU samples contain
sustained vowels lasting 1-3 seconds.
"""

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import torch
import torchaudio
import torchaudio.functional as F

from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.utils.kana_romaji import contains_kana, kana_to_romaji

logger = logging.getLogger(__name__)

# Target sample rate for MMS_FA model (16kHz)
MMS_FA_SAMPLE_RATE = 16000

# Energy analysis parameters for extending segments
ENERGY_HOP_LENGTH = 256  # ~16ms at 16kHz
ENERGY_THRESHOLD_RATIO = 0.1  # 10% above noise floor
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
) -> tuple[float, float]:
    """Detect sound boundaries using RMS energy analysis.

    For UTAU voicebank samples with sustained vowels, this provides the actual
    sound duration that CTC-based alignment misses.

    Args:
        audio: Raw audio samples (numpy array)
        sample_rate: Audio sample rate
        hop_length: Hop length for RMS calculation
        threshold_ratio: Ratio above noise floor to consider as sound

    Returns:
        Tuple of (start_ms, end_ms) representing sound boundaries
    """
    # Calculate RMS energy
    rms = librosa.feature.rms(y=audio, hop_length=hop_length)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sample_rate, hop_length=hop_length) * 1000

    if len(rms) == 0:
        return 0.0, len(audio) / sample_rate * 1000

    # Determine threshold using noise floor estimation
    noise_rms = np.percentile(rms, 10)  # Bottom 10% is likely silence
    signal_rms = np.percentile(rms, 90)  # Top 90% is likely signal

    # Threshold is threshold_ratio above noise floor
    threshold = noise_rms + (signal_rms - noise_rms) * threshold_ratio

    # Find where sound is above threshold
    above_threshold = rms > threshold

    if not any(above_threshold):
        # No sound detected, return full duration
        return 0.0, len(audio) / sample_rate * 1000

    # Find first and last frames above threshold
    first_frame = int(np.argmax(above_threshold))
    last_frame = len(rms) - 1 - int(np.argmax(above_threshold[::-1]))

    start_ms = float(times[first_frame])
    end_ms = float(times[last_frame]) + ENERGY_END_PADDING_MS

    return start_ms, end_ms


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
    ) -> PhonemeDetectionResult:
        """Detect phonemes using forced alignment with auto-extracted transcript.

        Extracts the expected transcript from the UTAU filename convention
        and performs forced alignment.

        Args:
            audio_path: Path to the audio file (WAV recommended)

        Returns:
            PhonemeDetectionResult containing aligned segments

        Raises:
            ForcedAlignmentError: If alignment fails
            TranscriptExtractionError: If transcript cannot be extracted
        """
        transcript = extract_transcript_from_filename(audio_path.name)
        return await self.detect_phonemes_with_transcript(audio_path, transcript)

    async def detect_phonemes_with_transcript(
        self,
        audio_path: Path,
        transcript: str,
    ) -> PhonemeDetectionResult:
        """Detect phonemes using forced alignment with provided transcript.

        Uses a hybrid approach for UTAU samples:
        1. Forced alignment detects phoneme onset positions
        2. Energy analysis extends the final segment to capture sustained sounds

        Args:
            audio_path: Path to the audio file (WAV recommended)
            transcript: Expected text/phonemes in the audio

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

        # Detect energy-based sound boundaries for extending segments
        energy_start_ms, energy_end_ms = detect_energy_boundaries(raw_audio, sample_rate)

        # Tokenize transcript
        tokens = tokenize_transcript(transcript, dictionary)

        try:
            # Generate emission probabilities from model
            with torch.inference_mode():
                emission, _ = model(waveform)

            # Prepare targets tensor [1, num_tokens]
            targets = torch.tensor([tokens], dtype=torch.int32, device=device)

            # Perform forced alignment
            # blank=0 is the CTC blank token
            alignments, scores = F.forced_align(emission, targets, blank=0)

            # Merge consecutive identical tokens to get spans
            # scores are log probabilities, exp() converts to probabilities
            token_spans = F.merge_tokens(alignments[0], scores[0].exp())

            # Convert to PhonemeSegments with energy-corrected boundaries
            segments = self._spans_to_segments(
                token_spans,
                transcript,
                waveform.size(1),
                emission.size(1),
                sample_rate,
                energy_start_ms=energy_start_ms,
                energy_end_ms=energy_end_ms,
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

    def _spans_to_segments(
        self,
        token_spans: list,
        transcript: str,
        num_samples: int,
        num_frames: int,
        sample_rate: int,
        energy_start_ms: float | None = None,
        energy_end_ms: float | None = None,
    ) -> list[PhonemeSegment]:
        """Convert token spans to PhonemeSegment objects.

        For UTAU samples with sustained vowels:
        - First segment start is adjusted if FA detected it too late
        - Final segment is extended to energy-detected sound end

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

        Returns:
            List of PhonemeSegment objects with timing in milliseconds
        """
        segments: list[PhonemeSegment] = []

        # Calculate frame duration
        # ratio = num_samples / num_frames gives samples per frame
        # samples_per_frame / sample_rate = seconds_per_frame
        ratio = num_samples / num_frames
        seconds_per_frame = ratio / sample_rate

        # Filter transcript to only valid characters (matching tokenization)
        # This ensures we have the right character for each span
        valid_chars = [c for c in transcript if c != " "]

        for i, span in enumerate(token_spans):
            # Get the character for this span (fallback to "?" if index out of range)
            phoneme = valid_chars[i] if i < len(valid_chars) else "?"

            # Convert frame indices to milliseconds
            start_ms = span.start * seconds_per_frame * 1000
            end_ms = span.end * seconds_per_frame * 1000

            # For the first segment, check if FA detected it too late
            # This happens when the model struggles with certain vowels
            is_first_segment = i == 0
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
            # This happens when FA detects a vowel at the end instead of after consonant
            if not is_first_segment and len(segments) > 0:
                prev_segment = segments[-1]
                gap = start_ms - prev_segment.end_ms
                if gap > MAX_SEGMENT_GAP_MS:
                    # Gap is too large, assume phoneme should follow previous
                    adjusted_start = prev_segment.end_ms + 10  # Small gap for transition
                    logger.debug(
                        f"Gap ({gap:.1f}ms) after '{prev_segment.phoneme}' is too large, "
                        f"adjusting '{phoneme}' start from {start_ms:.1f}ms to {adjusted_start:.1f}ms"
                    )
                    start_ms = adjusted_start

            # For the final segment, extend to energy-detected end if available
            # This captures sustained vowels that CTC models miss
            is_last_segment = i == len(token_spans) - 1
            if is_last_segment and energy_end_ms is not None:
                # Extend to energy-detected sound end
                end_ms = max(end_ms, energy_end_ms)

            # Score is already a probability (0-1) from exp()
            confidence = float(span.score)

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
