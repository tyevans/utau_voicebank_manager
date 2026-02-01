"""Auto-oto suggestion using ML phoneme detection results."""

import logging
from pathlib import Path

import numpy as np

from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.phoneme_detector import PhonemeDetector, preprocess_audio

logger = logging.getLogger(__name__)

# IPA consonant phonemes (common subset)
# Includes plosives, fricatives, affricates, nasals, liquids, glides
IPA_CONSONANTS = frozenset(
    [
        # Plosives
        "p",
        "b",
        "t",
        "d",
        "k",
        "g",
        "q",
        "c",
        # Fricatives
        "f",
        "v",
        "s",
        "z",
        "h",
        "x",
        # IPA fricatives
        "\u03b8",  # theta (voiceless dental)
        "\u00f0",  # eth (voiced dental)
        "\u0283",  # esh (sh sound)
        "\u0292",  # ezh (zh sound)
        "\u0282",  # retroflex s
        "\u0290",  # retroflex z
        "\u00e7",  # c cedilla (palatal fricative)
        "\u029c",  # voiced pharyngeal fricative
        # Affricates
        "t\u0283",  # t + esh (ch)
        "d\u0292",  # d + ezh (j)
        "ts",
        "dz",
        # Nasals
        "m",
        "n",
        "\u014b",  # eng (ng sound)
        "\u0272",  # palatal n
        "\u0273",  # retroflex n
        # Liquids
        "l",
        "r",
        "\u027e",  # alveolar tap
        "\u0279",  # alveolar approximant
        "\u027b",  # retroflex approximant
        "\u026d",  # retroflex l
        # Glides/Approximants
        "w",
        "j",
        "\u0265",  # labial-palatal approximant
        # Japanese-specific
        "\u0278",  # bilabial fricative (Japanese f)
    ]
)

# IPA vowel phonemes (common subset)
IPA_VOWELS = frozenset(
    [
        # Basic vowels
        "a",
        "e",
        "i",
        "o",
        "u",
        # Mid vowels
        "\u0259",  # schwa
        "\u025a",  # r-colored schwa
        # Open vowels
        "\u0251",  # open back unrounded (ah)
        "\u00e6",  # ash (ae)
        "\u0254",  # open-mid back rounded (aw)
        # Close vowels
        "\u026a",  # near-close near-front unrounded (short i)
        "\u028a",  # near-close near-back rounded (short u)
        "\u028c",  # open-mid back unrounded (uh)
        # Front vowels
        "\u025b",  # open-mid front unrounded (eh)
        "\u0153",  # oe ligature
        "\u00f8",  # o-slash (rounded front)
        # Other vowels
        "\u0268",  # close central unrounded
        "\u0289",  # close central rounded
        "\u026f",  # close back unrounded
        "\u0264",  # close-mid back unrounded
        "\u025c",  # open-mid central unrounded
        "\u025e",  # open-mid central rounded
        "\u0250",  # near-open central
        # Japanese vowels (explicit romaji-like)
        "a\u02d0",
        "i\u02d0",
        "u\u02d0",
        "e\u02d0",
        "o\u02d0",  # long vowels
    ]
)

# Default timing values when detection fails or has low confidence
DEFAULT_OFFSET_MS = 20.0
DEFAULT_PREUTTERANCE_MS = 60.0
DEFAULT_CONSONANT_MS = 100.0
DEFAULT_OVERLAP_MS = 25.0
DEFAULT_CUTOFF_PADDING_MS = 30.0

# Padding values for offset and cutoff estimation
OFFSET_PADDING_MS = 10.0
CUTOFF_PADDING_MS = 20.0

# Minimum confidence threshold for using detected segments
MIN_CONFIDENCE_THRESHOLD = 0.3

# Overlap ratio relative to preutterance
OVERLAP_RATIO = 0.4

# Consonant extension into vowel region ratio
CONSONANT_VOWEL_EXTENSION_RATIO = 0.3


class OtoSuggester:
    """Suggests oto parameters from phoneme detection results.

    Uses ML-detected phoneme boundaries to automatically estimate
    initial oto.ini parameters for voicebank samples.
    """

    def __init__(self, phoneme_detector: PhonemeDetector):
        """Initialize the oto suggester.

        Args:
            phoneme_detector: PhonemeDetector instance for phoneme detection
        """
        self.phoneme_detector = phoneme_detector

    async def suggest_oto(
        self,
        audio_path: Path,
        alias: str | None = None,
    ) -> OtoSuggestion:
        """Analyze audio and suggest oto parameters.

        Args:
            audio_path: Path to WAV file
            alias: Optional alias override (defaults to filename-based)

        Returns:
            OtoSuggestion with suggested parameters
        """
        # Get the filename for the suggestion
        filename = audio_path.name

        # Generate alias from filename if not provided
        if alias is None:
            alias = self._generate_alias_from_filename(filename)

        # Run phoneme detection
        try:
            detection_result = await self.phoneme_detector.detect_phonemes(audio_path)
            segments = detection_result.segments
            audio_duration_ms = detection_result.audio_duration_ms
        except Exception as e:
            logger.warning(f"Phoneme detection failed, using defaults: {e}")
            # Fall back to loading audio duration manually
            _, _, audio_duration_ms = preprocess_audio(audio_path)
            segments = []

        # Classify phonemes
        classification = self._classify_phonemes(segments)

        # Calculate confidence based on detection quality
        confidence = self._calculate_confidence(segments, audio_duration_ms)

        # Estimate parameters
        if segments and confidence >= MIN_CONFIDENCE_THRESHOLD:
            offset = self._estimate_offset(segments)
            consonant_end = self._estimate_consonant_end(segments, classification)
            preutterance = self._estimate_preutterance(segments, classification)
            cutoff = self._estimate_cutoff(audio_duration_ms, segments)
            overlap = self._estimate_overlap(offset, preutterance)
        else:
            # Use reasonable defaults
            logger.info(
                f"Low confidence ({confidence:.2f}) or no segments, using defaults"
            )
            offset = DEFAULT_OFFSET_MS
            preutterance = DEFAULT_PREUTTERANCE_MS
            consonant_end = DEFAULT_CONSONANT_MS
            cutoff = -DEFAULT_CUTOFF_PADDING_MS
            overlap = DEFAULT_OVERLAP_MS

        # Ensure consonant is at least as large as preutterance
        consonant_end = max(consonant_end, preutterance + 20)

        return OtoSuggestion(
            filename=filename,
            alias=alias,
            offset=round(offset, 1),
            consonant=round(consonant_end, 1),
            cutoff=round(cutoff, 1),
            preutterance=round(preutterance, 1),
            overlap=round(overlap, 1),
            confidence=round(confidence, 3),
            phonemes_detected=segments,
            audio_duration_ms=round(audio_duration_ms, 1),
        )

    def _generate_alias_from_filename(self, filename: str) -> str:
        """Generate a default alias from the filename.

        Args:
            filename: WAV filename (e.g., '_ka.wav')

        Returns:
            Generated alias (e.g., '- ka')
        """
        # Remove extension
        name = Path(filename).stem

        # Remove leading underscore if present
        if name.startswith("_"):
            name = name[1:]

        # Common pattern: add '- ' prefix for CV samples
        # This is a simple heuristic, user can override
        if len(name) <= 3 and name.isalpha():
            return f"- {name}"

        return name

    def _classify_phonemes(
        self, segments: list[PhonemeSegment]
    ) -> dict[str, list[PhonemeSegment]]:
        """Classify phonemes as consonants, vowels, or unknown.

        Args:
            segments: List of detected phoneme segments

        Returns:
            Dictionary with 'consonants', 'vowels', 'unknown' keys
        """
        result: dict[str, list[PhonemeSegment]] = {
            "consonants": [],
            "vowels": [],
            "unknown": [],
        }

        for segment in segments:
            phoneme = segment.phoneme.lower().strip()

            # Remove length markers for classification
            phoneme_base = phoneme.rstrip("\u02d0:")

            if phoneme_base in IPA_CONSONANTS or self._is_consonant_like(phoneme_base):
                result["consonants"].append(segment)
            elif phoneme_base in IPA_VOWELS or self._is_vowel_like(phoneme_base):
                result["vowels"].append(segment)
            else:
                # Try heuristics for unknown phonemes
                if self._is_vowel_like(phoneme_base):
                    result["vowels"].append(segment)
                elif self._is_consonant_like(phoneme_base):
                    result["consonants"].append(segment)
                else:
                    result["unknown"].append(segment)

        return result

    def _is_vowel_like(self, phoneme: str) -> bool:
        """Heuristic check if phoneme is vowel-like.

        Args:
            phoneme: Phoneme string to check

        Returns:
            True if likely a vowel
        """
        # Single character vowels
        if phoneme in "aeiou":
            return True

        # Japanese vowels in various notations
        return phoneme in {"aa", "ii", "uu", "ee", "oo"}

    def _is_consonant_like(self, phoneme: str) -> bool:
        """Heuristic check if phoneme is consonant-like.

        Args:
            phoneme: Phoneme string to check

        Returns:
            True if likely a consonant
        """
        # Common consonant letters not in basic vowel set
        consonant_letters = set("bcdfghjklmnpqrstvwxyz")
        if len(phoneme) == 1 and phoneme in consonant_letters:
            return True

        # Common Japanese consonant clusters
        return phoneme in {
            "sh",
            "ch",
            "ts",
            "dz",
            "ky",
            "gy",
            "ny",
            "hy",
            "my",
            "ry",
            "py",
            "by",
        }

    def _estimate_offset(self, segments: list[PhonemeSegment]) -> float:
        """Find where meaningful sound starts (skip initial silence).

        Args:
            segments: List of detected phoneme segments

        Returns:
            Estimated offset in milliseconds
        """
        if not segments:
            return DEFAULT_OFFSET_MS

        # Find the first segment with reasonable confidence
        for segment in segments:
            if segment.confidence >= MIN_CONFIDENCE_THRESHOLD:
                # Add padding before the first sound
                offset = max(0, segment.start_ms - OFFSET_PADDING_MS)
                return offset

        # Fall back to first segment regardless of confidence
        return max(0, segments[0].start_ms - OFFSET_PADDING_MS)

    def _estimate_consonant_end(
        self,
        segments: list[PhonemeSegment],
        classification: dict[str, list[PhonemeSegment]],
    ) -> float:
        """Find end of consonant/fixed region.

        The consonant value in oto.ini defines the "fixed" region that
        won't be time-stretched during synthesis.

        Args:
            segments: List of detected phoneme segments
            classification: Phoneme classification result

        Returns:
            Estimated consonant end time in milliseconds
        """
        if not segments:
            return DEFAULT_CONSONANT_MS

        consonants = classification.get("consonants", [])
        vowels = classification.get("vowels", [])

        # If we have both consonants and vowels, the fixed region typically
        # extends from offset through the consonant and slightly into the vowel
        if consonants and vowels:
            # Find the first vowel
            first_vowel = min(vowels, key=lambda s: s.start_ms)

            # Consonant region extends to end of consonant + part of vowel
            last_consonant_before_vowel = None
            for c in consonants:
                if c.end_ms <= first_vowel.start_ms and (
                    last_consonant_before_vowel is None
                    or c.end_ms > last_consonant_before_vowel.end_ms
                ):
                    last_consonant_before_vowel = c

            if last_consonant_before_vowel:
                # Extend into vowel by ratio
                vowel_extension = (
                    first_vowel.duration_ms * CONSONANT_VOWEL_EXTENSION_RATIO
                )
                return last_consonant_before_vowel.end_ms + vowel_extension

            # No consonant before vowel - use vowel start + extension
            vowel_extension = first_vowel.duration_ms * CONSONANT_VOWEL_EXTENSION_RATIO
            return first_vowel.start_ms + vowel_extension

        elif consonants:
            # Only consonants detected - use end of last consonant + buffer
            last_consonant = max(consonants, key=lambda s: s.end_ms)
            return last_consonant.end_ms + 20

        elif vowels:
            # Only vowels detected (rare for typical samples)
            first_vowel = min(vowels, key=lambda s: s.start_ms)
            # Fixed region is just a portion of the vowel
            return first_vowel.start_ms + first_vowel.duration_ms * 0.4

        # Use last segment end as fallback
        return segments[-1].end_ms if segments else DEFAULT_CONSONANT_MS

    def _estimate_preutterance(
        self,
        segments: list[PhonemeSegment],
        classification: dict[str, list[PhonemeSegment]],
    ) -> float:
        """Estimate preutterance position (absolute position from audio start).

        Preutterance is the absolute position where the note timing aligns,
        typically at or near the consonant-vowel boundary.

        Args:
            segments: List of detected phoneme segments
            classification: Phoneme classification result

        Returns:
            Estimated preutterance position in milliseconds (from audio start)
        """
        if not segments:
            return DEFAULT_PREUTTERANCE_MS

        consonants = classification.get("consonants", [])
        vowels = classification.get("vowels", [])

        # Standard case: preutterance = position at consonant-vowel boundary
        if consonants and vowels:
            first_vowel = min(vowels, key=lambda s: s.start_ms)

            # Find last consonant before the first vowel
            consonants_before_vowel = [
                c for c in consonants if c.end_ms <= first_vowel.start_ms
            ]

            if consonants_before_vowel:
                # Preutterance is at the end of the last consonant (CV boundary)
                last_consonant = max(consonants_before_vowel, key=lambda s: s.end_ms)
                return last_consonant.end_ms

            # No consonant before vowel - preutterance at vowel start
            return first_vowel.start_ms

        elif consonants:
            # Only consonants - preutterance at end of last consonant
            last_consonant = max(consonants, key=lambda s: s.end_ms)
            return last_consonant.end_ms

        elif vowels:
            # Only vowels - preutterance at first vowel start
            first_vowel = min(vowels, key=lambda s: s.start_ms)
            return first_vowel.start_ms

        # Fallback: use first segment end
        return segments[0].end_ms if segments else DEFAULT_PREUTTERANCE_MS

    def _estimate_overlap(self, offset: float, preutterance: float) -> float:
        """Estimate overlap position (absolute position from audio start).

        Overlap is the position where crossfade with the previous note occurs,
        typically positioned between offset and preutterance.

        Args:
            offset: Estimated offset position (from audio start)
            preutterance: Estimated preutterance position (from audio start)

        Returns:
            Estimated overlap position in milliseconds (from audio start)
        """
        # Overlap is typically positioned between offset and preutterance
        # Use OVERLAP_RATIO to position it partway between them
        if preutterance <= offset:
            # Edge case: preutterance at or before offset
            return offset

        # Position overlap at OVERLAP_RATIO of the way from offset to preutterance
        overlap = offset + (preutterance - offset) * OVERLAP_RATIO

        return overlap

    def _estimate_cutoff(
        self, audio_duration_ms: float, segments: list[PhonemeSegment]
    ) -> float:
        """Find where to cut off (detect trailing silence).

        Returns a negative value representing milliseconds from audio end.

        Args:
            audio_duration_ms: Total audio duration
            segments: List of detected phoneme segments

        Returns:
            Estimated cutoff in milliseconds (negative)
        """
        if not segments:
            return -DEFAULT_CUTOFF_PADDING_MS

        # Find the last segment with reasonable confidence
        last_segment = None
        for segment in reversed(segments):
            if segment.confidence >= MIN_CONFIDENCE_THRESHOLD:
                last_segment = segment
                break

        if last_segment is None:
            last_segment = segments[-1]

        # Calculate cutoff as negative offset from end
        # Add padding after last phoneme
        sound_end = last_segment.end_ms + CUTOFF_PADDING_MS

        # Cutoff is negative, representing distance from audio end
        cutoff = -(audio_duration_ms - sound_end)

        # Ensure cutoff is negative and reasonable
        # If sound extends very close to end, use small negative value
        return min(cutoff, -10)

    def _calculate_confidence(
        self, segments: list[PhonemeSegment], audio_duration_ms: float
    ) -> float:
        """Calculate overall confidence in the suggestion.

        Based on:
        - Number of detected segments
        - Average segment confidence
        - Coverage of audio duration

        Args:
            segments: List of detected phoneme segments
            audio_duration_ms: Total audio duration

        Returns:
            Overall confidence score (0-1)
        """
        if not segments:
            return 0.0

        # Factor 1: Average segment confidence
        avg_confidence = float(np.mean([s.confidence for s in segments]))

        # Factor 2: Coverage of audio (segments should cover reasonable portion)
        total_segment_duration = sum(s.duration_ms for s in segments)
        coverage = (
            min(1.0, total_segment_duration / audio_duration_ms)
            if audio_duration_ms > 0
            else 0
        )

        # Factor 3: Number of segments (penalize too few or too many)
        # Optimal is 2-5 segments for typical CV/VCV samples
        segment_count = len(segments)
        if segment_count == 0:
            segment_factor = 0.0
        elif 2 <= segment_count <= 5:
            segment_factor = 1.0
        elif segment_count == 1:
            segment_factor = 0.7
        elif segment_count <= 10:
            segment_factor = 0.8
        else:
            segment_factor = 0.5  # Too many segments might indicate noise

        # Weighted combination
        confidence = avg_confidence * 0.5 + coverage * 0.3 + segment_factor * 0.2

        return min(1.0, max(0.0, confidence))


# Module-level singleton
_default_suggester: OtoSuggester | None = None


def get_oto_suggester(phoneme_detector: PhonemeDetector | None = None) -> OtoSuggester:
    """Get the default oto suggester singleton.

    Args:
        phoneme_detector: Optional phoneme detector to use.
                         If not provided, uses the default detector.

    Returns:
        OtoSuggester instance
    """
    global _default_suggester

    if _default_suggester is None:
        from src.backend.ml.phoneme_detector import get_phoneme_detector

        detector = phoneme_detector or get_phoneme_detector()
        _default_suggester = OtoSuggester(detector)

    return _default_suggester
