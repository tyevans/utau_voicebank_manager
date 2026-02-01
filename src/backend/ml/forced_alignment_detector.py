"""Forced alignment phoneme detector using TorchAudio's MMS_FA model.

This module provides high-accuracy phoneme boundary detection for UTAU samples
by leveraging forced alignment. Unlike blind recognition, forced alignment
uses the known expected phonemes (extracted from filenames like _ka.wav)
to achieve much more accurate timing boundaries.

Uses torchaudio.pipelines.MMS_FA which is trained on 1100+ languages.
"""

import logging
import re
from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import torch
import torchaudio
import torchaudio.functional as F

from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment

logger = logging.getLogger(__name__)

# Target sample rate for MMS_FA model (16kHz)
MMS_FA_SAMPLE_RATE = 16000

# Cache directory for models
MODELS_DIR = Path(__file__).parent.parent.parent.parent / "models" / "torchaudio"


class ForcedAlignmentError(Exception):
    """Raised when forced alignment fails."""

    pass


class TranscriptExtractionError(Exception):
    """Raised when transcript cannot be extracted from filename."""

    pass


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
    - _a_ka.wav -> "aka" (VCV style)
    - あ.wav -> "a" (hiragana)

    Args:
        filename: The audio filename (with or without path)

    Returns:
        Extracted transcript text (romaji/characters)

    Raises:
        TranscriptExtractionError: If transcript cannot be extracted
    """
    # Get just the filename without path
    name = Path(filename).stem

    # Remove leading underscore(s) common in UTAU files
    name = name.lstrip("_")

    # Remove any numeric prefix (like "01_ka" -> "ka")
    name = re.sub(r"^\d+[_-]?", "", name)

    # Handle VCV-style names with underscores (a_ka -> aka)
    # But preserve meaningful separators
    name = name.replace("_", "")

    # Handle special UTAU notation
    # - Remove breath marks and special characters
    name = re.sub(r"[-・。、]", "", name)

    # Convert to lowercase for consistency
    name = name.lower()

    if not name:
        raise TranscriptExtractionError(
            f"Could not extract transcript from filename: {filename}"
        )

    return name


def preprocess_audio_for_alignment(
    file_path: Path,
    target_sr: int = MMS_FA_SAMPLE_RATE,
) -> tuple[torch.Tensor, int, float]:
    """Load and preprocess audio for MMS_FA forced alignment.

    Args:
        file_path: Path to the audio file
        target_sr: Target sample rate (16kHz for MMS_FA)

    Returns:
        Tuple of (waveform_tensor, sample_rate, duration_ms)

    Raises:
        ForcedAlignmentError: If audio cannot be processed
    """
    try:
        # Load audio with librosa for robust format handling
        audio, sr = librosa.load(str(file_path), sr=target_sr, mono=True)

        # Calculate duration in milliseconds
        duration_ms = (len(audio) / sr) * 1000

        # Normalize audio
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        # Convert to torch tensor with batch dimension [1, num_samples]
        waveform = torch.from_numpy(audio).float().unsqueeze(0)

        return waveform, sr, duration_ms

    except Exception as e:
        logger.exception(f"Failed to process audio file: {file_path}")
        raise ForcedAlignmentError(f"Failed to process audio: {e}") from e


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
        waveform, sample_rate, duration_ms = preprocess_audio_for_alignment(audio_path)
        waveform = waveform.to(device)

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

            # Convert to PhonemeSegments
            segments = self._spans_to_segments(
                token_spans,
                transcript,
                waveform.size(1),
                emission.size(1),
                sample_rate,
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
    ) -> list[PhonemeSegment]:
        """Convert token spans to PhonemeSegment objects.

        Args:
            token_spans: List of TokenSpan objects from merge_tokens
            transcript: Original transcript text
            num_samples: Number of audio samples
            num_frames: Number of emission frames
            sample_rate: Audio sample rate

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
