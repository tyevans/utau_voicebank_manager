"""Auto-oto suggestion using ML phoneme detection results."""

import logging
from pathlib import Path

import librosa
import numpy as np

from src.backend.domain.alignment_config import AlignmentConfig, AlignmentParams
from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.ml.forced_alignment_detector import (
    ForcedAlignmentDetector,
    ForcedAlignmentError,
    TranscriptExtractionError,
    extract_transcript_from_filename,
    get_forced_alignment_detector,
)
from src.backend.ml.sofa_aligner import (
    AlignmentError,
    AlignmentResult,
    DictionaryValidationError,
    SOFAForcedAligner,
    get_sofa_aligner,
    is_sofa_available,
)

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

# Overlap ratio relative to preutterance (default fallback)
OVERLAP_RATIO = 0.4

# Consonant-type-aware overlap ratios.
# Different consonant types need different crossfade amounts:
# - Plosives have a sharp stop closure that creates a natural boundary
# - Fricatives have gradual noise onset allowing smooth crossfade
# - Nasals are voiced and smooth, benefit from longer crossfade
# - Liquids/glides are vowel-like with very smooth transitions
# - Affricates have a stop component like plosives
# Keys include both IPA and romanized forms used by aligners.
CONSONANT_OVERLAP_RATIOS: dict[str, float] = {
    # Plosives - sharp onset, short overlap
    "k": 0.2,
    "g": 0.2,
    "t": 0.2,
    "d": 0.2,
    "p": 0.2,
    "b": 0.2,
    "q": 0.2,
    "c": 0.2,
    # Affricates - stop component, short overlap
    "ch": 0.25,
    "ts": 0.25,
    "dz": 0.25,
    "t\u0283": 0.25,  # t + esh (IPA ch)
    "d\u0292": 0.25,  # d + ezh (IPA j/dʒ)
    # Fricatives - gradual noise, medium overlap
    "s": 0.4,
    "sh": 0.4,
    "h": 0.4,
    "f": 0.4,
    "z": 0.4,
    "v": 0.4,
    "x": 0.4,
    "\u03b8": 0.4,  # theta
    "\u00f0": 0.4,  # eth
    "\u0283": 0.4,  # esh (sh)
    "\u0292": 0.4,  # ezh (zh)
    "\u0282": 0.4,  # retroflex s
    "\u0290": 0.4,  # retroflex z
    "\u00e7": 0.4,  # palatal fricative
    "\u0278": 0.4,  # bilabial fricative (Japanese f)
    # Nasals - voiced and smooth, longer overlap
    "n": 0.6,
    "m": 0.6,
    "ny": 0.6,
    "\u014b": 0.6,  # eng (ng)
    "\u0272": 0.6,  # palatal n
    "\u0273": 0.6,  # retroflex n
    # Liquids/Glides - vowel-like, longest overlap
    "r": 0.6,
    "w": 0.6,
    "y": 0.6,
    "j": 0.6,  # IPA glide (= English y)
    "l": 0.6,
    "\u027e": 0.6,  # alveolar tap
    "\u0279": 0.6,  # alveolar approximant
    "\u027b": 0.6,  # retroflex approximant
    "\u026d": 0.6,  # retroflex l
    "\u0265": 0.6,  # labial-palatal approximant
    # Japanese palatalized consonants - use base consonant type
    "ky": 0.2,
    "gy": 0.2,
    "py": 0.2,
    "by": 0.2,
    "hy": 0.4,
    "my": 0.6,
    "ry": 0.6,
}

# Consonant extension into vowel region ratio
CONSONANT_VOWEL_EXTENSION_RATIO = 0.3


class OtoSuggester:
    """Suggests oto parameters from phoneme detection results.

    Uses ML-detected phoneme boundaries to automatically estimate
    initial oto.ini parameters for voicebank samples.

    Supports multiple detection modes:
    - SOFA alignment: Optimized for singing voice (enabled with use_sofa=True)
    - MMS_FA forced alignment (default): Higher accuracy using expected phonemes
      from filename with TorchAudio's MMS_FA model
    - Defaults: Energy-based fallback when ML methods fail
    """

    def __init__(
        self,
        use_forced_alignment: bool = True,
        use_sofa: bool = False,
        alignment_config: AlignmentConfig | None = None,
    ):
        """Initialize the oto suggester.

        Args:
            use_forced_alignment: If True, attempt MMS_FA forced alignment.
                                  Falls back to defaults on failure.
                                  Defaults to True.
            use_sofa: If True, attempt SOFA (Singing-Oriented Forced Aligner) first.
                     SOFA is optimized for singing voice and produces better results
                     for sustained vowels. Falls back to MMS_FA if unavailable.
                     Defaults to False.
            alignment_config: Optional AlignmentConfig for controlling alignment
                             parameters. If not provided, uses default config.
        """
        self._forced_alignment_detector: ForcedAlignmentDetector | None = None
        self._sofa_aligner: SOFAForcedAligner | None = None
        self.use_forced_alignment = use_forced_alignment
        self.use_sofa = use_sofa
        self._alignment_config = alignment_config or AlignmentConfig()

    @property
    def forced_alignment_detector(self) -> ForcedAlignmentDetector:
        """Get the forced alignment detector, loading lazily if needed."""
        if self._forced_alignment_detector is None:
            self._forced_alignment_detector = get_forced_alignment_detector()
        return self._forced_alignment_detector

    @property
    def sofa_aligner(self) -> SOFAForcedAligner:
        """Get the SOFA aligner, loading lazily if needed."""
        if self._sofa_aligner is None:
            self._sofa_aligner = get_sofa_aligner()
        return self._sofa_aligner

    def _get_params(self, recording_style: str | None = None) -> AlignmentParams:
        """Get alignment parameters for the given recording style.

        Args:
            recording_style: Optional recording style (cv, vcv, cvvc) for
                style-specific adjustments.

        Returns:
            AlignmentParams with values derived from tightness setting.
        """
        return self._alignment_config.get_params(recording_style)

    async def suggest_oto(
        self,
        audio_path: Path,
        alias: str | None = None,
        sofa_language: str = "ja",
        recording_style: str | None = None,
    ) -> OtoSuggestion:
        """Analyze audio and suggest oto parameters.

        Args:
            audio_path: Path to WAV file
            alias: Optional alias override (defaults to filename-based)
            sofa_language: Language code for SOFA alignment (ja, en, zh, ko, fr)
            recording_style: Optional recording style (cv, vcv, cvvc) for
                style-specific parameter adjustments.

        Returns:
            OtoSuggestion with suggested parameters
        """
        # Get the filename for the suggestion
        filename = audio_path.name

        # Generate alias from filename if not provided
        if alias is None:
            alias = self._generate_alias_from_filename(filename)

        # Get alignment parameters for this recording style
        params = self._get_params(recording_style)

        # Run phoneme detection
        segments = []
        audio_duration_ms = 0.0
        detection_method = "none"

        # Determine which methods to try based on method_override
        method_override = self._alignment_config.method_override
        try_sofa = self.use_sofa and is_sofa_available()
        try_fa = self.use_forced_alignment

        if method_override == "sofa":
            try_fa = False
        elif method_override == "fa":
            try_sofa = False
        # "blind" is no longer a supported method - treat as auto (defaults)

        # Try SOFA alignment first if enabled and available
        if try_sofa:
            try:
                # Extract transcript from filename for SOFA
                transcript = extract_transcript_from_filename(filename)
                alignment_result = await self.sofa_aligner.align(
                    audio_path, transcript, language=sofa_language
                )
                segments = alignment_result.segments
                audio_duration_ms = alignment_result.audio_duration_ms
                detection_method = "sofa"
                logger.info(
                    f"SOFA alignment succeeded for {filename}: "
                    f"{len(segments)} segments detected"
                )
            except DictionaryValidationError as e:
                # Phonemes not in SOFA dictionary - expected for some samples
                # Log at info level and fall back to other methods
                logger.info(
                    f"SOFA dictionary validation failed for {filename}: "
                    f"unrecognized phonemes {e.unrecognized_phonemes}. "
                    "Falling back to MMS_FA forced alignment."
                )
            except AlignmentError as e:
                logger.warning(
                    f"SOFA alignment failed for {filename}, "
                    f"falling back to MMS_FA forced alignment: {e}"
                )

        # Try MMS_FA forced alignment if SOFA didn't work
        if not segments and try_fa:
            try:
                detection_result = await self.forced_alignment_detector.detect_phonemes(
                    audio_path, alignment_params=params
                )
                segments = detection_result.segments
                audio_duration_ms = detection_result.audio_duration_ms
                detection_method = "forced_alignment"
                logger.info(
                    f"MMS_FA forced alignment succeeded for {filename}: "
                    f"{len(segments)} segments detected"
                )
            except (ForcedAlignmentError, TranscriptExtractionError) as e:
                logger.warning(
                    f"MMS_FA forced alignment failed for {filename}, "
                    f"using defaults: {e}"
                )

        # Fall back to defaults if all ML methods failed
        if not segments and not audio_duration_ms:
            try:
                audio_duration_ms = librosa.get_duration(path=str(audio_path)) * 1000
            except Exception as e:
                logger.warning(f"Failed to get audio duration for {filename}: {e}")
                audio_duration_ms = 1000.0  # Default 1 second
            detection_method = "defaults"

        logger.debug(f"Detection method for {filename}: {detection_method}")

        # Classify phonemes
        classification = self._classify_phonemes(segments)

        # Calculate confidence based on detection quality
        confidence = self._calculate_confidence(segments, audio_duration_ms)

        # Estimate parameters using alignment params from config
        if segments and confidence >= params.min_confidence_threshold:
            offset = self._estimate_offset(segments, params)
            consonant_end = self._estimate_consonant_end(
                segments, classification, params
            )
            preutterance = self._estimate_preutterance(segments, classification)
            cutoff = self._estimate_cutoff(audio_duration_ms, segments, params)
            consonant_at_preutterance = self._find_preutterance_consonant(
                classification
            )
            overlap = self._estimate_overlap(
                offset, preutterance, params, consonant_at_preutterance
            )
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

    async def batch_suggest_oto(
        self,
        audio_paths: list[Path],
        aliases: list[str] | None = None,
        sofa_language: str = "ja",
    ) -> list[OtoSuggestion | None]:
        """Analyze multiple audio files and suggest oto parameters in batch.

        Uses batch alignment only:
        1. Batch SOFA alignment (if available)
        2. Batch MMS_FA for SOFA failures

        Files that fail both techniques are returned as None.

        Args:
            audio_paths: List of paths to WAV files
            aliases: Optional list of aliases (same length as audio_paths).
                    If None, aliases are generated from filenames.
            sofa_language: Language code for SOFA alignment (ja, en, zh, ko, fr)

        Returns:
            List of OtoSuggestion | None (same order as input paths).
            None entries indicate files that failed all alignment techniques.
        """
        if not audio_paths:
            return []

        # Validate aliases length if provided
        if aliases is not None and len(aliases) != len(audio_paths):
            raise ValueError(
                f"aliases length ({len(aliases)}) must match "
                f"audio_paths length ({len(audio_paths)})"
            )

        # Extract transcripts for all files
        path_to_transcript: dict[Path, str] = {}
        for audio_path in audio_paths:
            filename = audio_path.name
            try:
                transcript = extract_transcript_from_filename(filename)
                path_to_transcript[audio_path] = transcript
            except TranscriptExtractionError as e:
                logger.warning(
                    f"Failed to extract transcript from {filename}: {e}. "
                    "File will be skipped."
                )
                path_to_transcript[audio_path] = ""

        # Initialize suggestions list with None placeholders
        suggestions: list[OtoSuggestion | None] = [None] * len(audio_paths)

        # Build a set of paths still needing alignment (have valid transcripts)
        pending_indices: list[int] = list(range(len(audio_paths)))

        # Phase 1: Batch SOFA (if available)
        if self.use_sofa and is_sofa_available():
            sofa_items = [
                (audio_paths[idx], path_to_transcript[audio_paths[idx]])
                for idx in pending_indices
                if path_to_transcript[audio_paths[idx]]
            ]
            if sofa_items:
                sofa_results: dict[Path, AlignmentResult] = {}
                try:
                    sofa_results = await self.sofa_aligner.batch_align(
                        sofa_items, language=sofa_language
                    )
                    logger.info(
                        f"SOFA batch alignment succeeded for "
                        f"{len(sofa_results)}/{len(sofa_items)} files"
                    )
                except AlignmentError as e:
                    logger.warning(
                        f"SOFA batch alignment failed entirely: {e}. "
                        "Proceeding to MMS_FA batch."
                    )

                # Build suggestions from SOFA results
                resolved_indices: list[int] = []
                for idx in pending_indices:
                    audio_path = audio_paths[idx]
                    if audio_path in sofa_results:
                        result = sofa_results[audio_path]
                        alias = (
                            aliases[idx]
                            if aliases is not None
                            else self._generate_alias_from_filename(audio_path.name)
                        )
                        suggestions[idx] = self._build_suggestion_from_alignment(
                            filename=audio_path.name,
                            alias=alias,
                            segments=result.segments,
                            audio_duration_ms=result.audio_duration_ms,
                            detection_method="sofa",
                        )
                        resolved_indices.append(idx)

                # Remove resolved indices from pending
                pending_indices = [
                    idx for idx in pending_indices if idx not in resolved_indices
                ]

        # Phase 2: Batch MMS_FA for files that failed SOFA (or if SOFA unavailable)
        if pending_indices and self.use_forced_alignment:
            params = self._get_params()
            mms_items = [
                (audio_paths[idx], path_to_transcript[audio_paths[idx]])
                for idx in pending_indices
                if path_to_transcript[audio_paths[idx]]
            ]
            if mms_items:
                mms_results: dict[Path, PhonemeDetectionResult] = {}
                try:
                    mms_results = (
                        await self.forced_alignment_detector.batch_detect_phonemes(
                            mms_items, alignment_params=params
                        )
                    )
                    logger.info(
                        f"MMS_FA batch alignment succeeded for "
                        f"{len(mms_results)}/{len(mms_items)} files"
                    )
                except ForcedAlignmentError as e:
                    logger.warning(
                        f"MMS_FA batch alignment failed entirely: {e}. "
                        "Remaining files will be skipped."
                    )

                # Build suggestions from MMS_FA results
                resolved_indices = []
                for idx in pending_indices:
                    audio_path = audio_paths[idx]
                    if audio_path in mms_results:
                        result = mms_results[audio_path]
                        alias = (
                            aliases[idx]
                            if aliases is not None
                            else self._generate_alias_from_filename(audio_path.name)
                        )
                        suggestions[idx] = self._build_suggestion_from_alignment(
                            filename=audio_path.name,
                            alias=alias,
                            segments=result.segments,
                            audio_duration_ms=result.audio_duration_ms,
                            detection_method="forced_alignment",
                        )
                        resolved_indices.append(idx)

                # Remove resolved indices from pending
                pending_indices = [
                    idx for idx in pending_indices if idx not in resolved_indices
                ]

        # Log files that failed all batch techniques (left as None)
        if pending_indices:
            failed_names = [audio_paths[idx].name for idx in pending_indices]
            logger.warning(
                f"{len(pending_indices)} files failed all batch alignment "
                f"techniques: {failed_names[:10]}"
            )

        return suggestions

    def _build_suggestion_from_alignment(
        self,
        filename: str,
        alias: str,
        segments: list[PhonemeSegment],
        audio_duration_ms: float,
        detection_method: str,
        params: AlignmentParams | None = None,
    ) -> OtoSuggestion:
        """Build an OtoSuggestion from alignment results.

        Uses the same parameter estimation logic as suggest_oto().

        Args:
            filename: WAV filename
            alias: Phoneme alias
            segments: Detected phoneme segments
            audio_duration_ms: Total audio duration
            detection_method: Detection method used (for logging)
            params: Optional alignment params. If not provided, uses default config.

        Returns:
            OtoSuggestion with estimated parameters
        """
        logger.debug(f"Detection method for {filename}: {detection_method}")

        # Use provided params or get default
        if params is None:
            params = self._get_params()

        # Classify phonemes
        classification = self._classify_phonemes(segments)

        # Calculate confidence based on detection quality
        confidence = self._calculate_confidence(segments, audio_duration_ms)

        # Estimate parameters using alignment params from config
        if segments and confidence >= params.min_confidence_threshold:
            offset = self._estimate_offset(segments, params)
            consonant_end = self._estimate_consonant_end(
                segments, classification, params
            )
            preutterance = self._estimate_preutterance(segments, classification)
            cutoff = self._estimate_cutoff(audio_duration_ms, segments, params)
            consonant_at_preutterance = self._find_preutterance_consonant(
                classification
            )
            overlap = self._estimate_overlap(
                offset, preutterance, params, consonant_at_preutterance
            )
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

    def _find_main_vowel(
        self,
        consonants: list[PhonemeSegment],
        vowels: list[PhonemeSegment],
    ) -> PhonemeSegment:
        """Identify the main (sustain) vowel for oto parameter estimation.

        For CV samples (e.g., [k, a]), the main vowel is the first and only
        vowel. For VCV samples (e.g., [a1, k, a2]), the main vowel is the
        vowel after the consonant(s) -- the sustain vowel, not the preceding
        vowel that gets crossfaded out.

        The detection is purely structural: if any vowel appears after a
        consonant, the first such vowel is the main vowel. Otherwise, the
        first vowel overall is used.

        Args:
            consonants: Classified consonant segments (may be empty).
            vowels: Classified vowel segments (must be non-empty).

        Returns:
            The PhonemeSegment representing the main vowel.
        """
        if not consonants:
            # No consonants -- just use the first vowel
            return min(vowels, key=lambda s: s.start_ms)

        # Find the latest consonant end time
        last_consonant_end = max(c.end_ms for c in consonants)

        # Look for vowels that start at or after any consonant ends.
        # These are post-consonant vowels (the sustain vowel in VCV).
        vowels_after_consonant = [
            v for v in vowels if v.start_ms >= last_consonant_end - 1e-3
        ]

        if vowels_after_consonant:
            # Use the first vowel after the last consonant block
            return min(vowels_after_consonant, key=lambda s: s.start_ms)

        # Broader check: any vowel that starts after ANY consonant's start.
        # This handles cases where consonant/vowel boundaries overlap slightly.
        earliest_consonant_start = min(c.start_ms for c in consonants)
        vowels_after_any_consonant = [
            v for v in vowels if v.start_ms > earliest_consonant_start
        ]

        if vowels_after_any_consonant:
            return min(vowels_after_any_consonant, key=lambda s: s.start_ms)

        # Fallback: all vowels come before all consonants (unusual, e.g., VC).
        # Use the first vowel.
        return min(vowels, key=lambda s: s.start_ms)

    def _estimate_offset(
        self,
        segments: list[PhonemeSegment],
        params: AlignmentParams | None = None,
    ) -> float:
        """Find where meaningful sound starts (skip initial silence).

        Args:
            segments: List of detected phoneme segments
            params: Optional alignment params for padding values.
                   If not provided, uses module-level defaults.

        Returns:
            Estimated offset in milliseconds
        """
        if not segments:
            return DEFAULT_OFFSET_MS

        # Use params or fall back to module-level constants
        offset_padding = params.offset_padding_ms if params else OFFSET_PADDING_MS
        min_confidence = (
            params.min_confidence_threshold if params else MIN_CONFIDENCE_THRESHOLD
        )

        # Find the first segment with reasonable confidence
        for segment in segments:
            if segment.confidence >= min_confidence:
                # Add padding before the first sound
                offset = max(0, segment.start_ms - offset_padding)
                return offset

        # Fall back to first segment regardless of confidence
        return max(0, segments[0].start_ms - offset_padding)

    def _estimate_consonant_end(
        self,
        segments: list[PhonemeSegment],
        classification: dict[str, list[PhonemeSegment]],
        params: AlignmentParams | None = None,
    ) -> float:
        """Find end of consonant/fixed region.

        The consonant value in oto.ini defines the "fixed" region that
        won't be time-stretched during synthesis.

        Args:
            segments: List of detected phoneme segments
            classification: Phoneme classification result
            params: Optional alignment params for extension ratio.
                   If not provided, uses module-level defaults.

        Returns:
            Estimated consonant end time in milliseconds
        """
        if not segments:
            return DEFAULT_CONSONANT_MS

        # Use params or fall back to module-level constant
        cv_extension_ratio = (
            params.consonant_vowel_extension_ratio
            if params
            else CONSONANT_VOWEL_EXTENSION_RATIO
        )

        consonants = classification.get("consonants", [])
        vowels = classification.get("vowels", [])

        # If we have both consonants and vowels, the fixed region typically
        # extends from offset through the consonant and slightly into the vowel.
        # For VCV samples, use the sustain vowel (after consonant), not the
        # preceding vowel.
        if consonants and vowels:
            # Find the main (sustain) vowel -- handles both CV and VCV
            main_vowel = self._find_main_vowel(consonants, vowels)

            # Consonant region extends to end of consonant + part of vowel
            last_consonant_before_vowel = None
            for c in consonants:
                if c.end_ms <= main_vowel.start_ms + 1e-3 and (
                    last_consonant_before_vowel is None
                    or c.end_ms > last_consonant_before_vowel.end_ms
                ):
                    last_consonant_before_vowel = c

            if last_consonant_before_vowel:
                # Extend into vowel by ratio
                vowel_extension = main_vowel.duration_ms * cv_extension_ratio
                return last_consonant_before_vowel.end_ms + vowel_extension

            # No consonant before main vowel - use vowel start + extension
            vowel_extension = main_vowel.duration_ms * cv_extension_ratio
            return main_vowel.start_ms + vowel_extension

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

        # Standard case: preutterance = position at consonant-vowel boundary.
        # For VCV samples, use the boundary before the sustain vowel (after
        # the consonant), not the preceding vowel.
        if consonants and vowels:
            # Find the main (sustain) vowel -- handles both CV and VCV
            main_vowel = self._find_main_vowel(consonants, vowels)

            # Find last consonant before the main vowel
            consonants_before_vowel = [
                c for c in consonants if c.end_ms <= main_vowel.start_ms + 1e-3
            ]

            if consonants_before_vowel:
                # Preutterance is at the end of the last consonant (C->V boundary)
                last_consonant = max(consonants_before_vowel, key=lambda s: s.end_ms)
                return last_consonant.end_ms

            # No consonant before main vowel - preutterance at vowel start
            return main_vowel.start_ms

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

    @staticmethod
    def _strip_ipa_modifiers(phoneme: str) -> str:
        """Strip IPA modifier characters to get the base phoneme.

        Removes aspiration markers, length markers, diacritics, and
        other IPA modifiers to produce a lookup key for consonant
        type classification.

        Args:
            phoneme: Raw phoneme string (e.g., "kʰ", "sː", "t̪")

        Returns:
            Base phoneme string (e.g., "k", "s", "t")
        """
        # IPA modifier/diacritic codepoints to strip
        modifiers = frozenset(
            "\u02b0"  # ʰ aspiration
            "\u02d0"  # ː length mark
            "\u02d1"  # ˑ half-length
            "\u0325"  # ̥ voiceless diacritic (combining)
            "\u032a"  # ̪ dental diacritic (combining)
            "\u0339"  # ̹ more rounded (combining)
            "\u031c"  # ̜ less rounded (combining)
            "\u0334"  # ̴ velarized (combining)
            "\u02bc"  # ʼ ejective
            "\u0361"  # ͡ tie bar (combining)
            "\u035c"  # ͜ tie bar below (combining)
            "\u207f"  # ⁿ nasal release
            ":"  # ASCII length mark alternative
        )
        return "".join(ch for ch in phoneme if ch not in modifiers)

    def _find_preutterance_consonant(
        self,
        classification: dict[str, list[PhonemeSegment]],
    ) -> str | None:
        """Find the consonant phoneme closest to the preutterance point.

        The preutterance sits at the consonant-vowel boundary, so the
        relevant consonant is the last one before the main vowel. This
        mirrors the logic in _estimate_preutterance().

        Args:
            classification: Phoneme classification with 'consonants' and
                'vowels' keys.

        Returns:
            Base phoneme string of the consonant at preutterance, or None
            if no consonant is found.
        """
        consonants = classification.get("consonants", [])
        vowels = classification.get("vowels", [])

        if not consonants:
            return None

        if consonants and vowels:
            main_vowel = self._find_main_vowel(consonants, vowels)
            consonants_before_vowel = [
                c for c in consonants if c.end_ms <= main_vowel.start_ms + 1e-3
            ]
            if consonants_before_vowel:
                last_consonant = max(consonants_before_vowel, key=lambda s: s.end_ms)
                return self._strip_ipa_modifiers(last_consonant.phoneme.lower().strip())

        # Fallback: use the last consonant overall
        last_consonant = max(consonants, key=lambda s: s.end_ms)
        return self._strip_ipa_modifiers(last_consonant.phoneme.lower().strip())

    def _estimate_overlap(
        self,
        offset: float,
        preutterance: float,
        params: AlignmentParams | None = None,
        consonant_phoneme: str | None = None,
    ) -> float:
        """Estimate overlap position (absolute position from audio start).

        Overlap is the position where crossfade with the previous note occurs,
        typically positioned between offset and preutterance. The overlap ratio
        is selected based on the consonant type at the preutterance point:

        - Plosives (k, t, p, ...): Short overlap (0.2) -- sharp stop closure
        - Affricates (ch, ts, ...): Short overlap (0.25) -- stop component
        - Fricatives (s, sh, f, ...): Medium overlap (0.4) -- gradual noise
        - Nasals (n, m, ...): Longer overlap (0.6) -- smooth and voiced
        - Liquids/Glides (r, w, y, ...): Longest overlap (0.6) -- vowel-like

        Args:
            offset: Estimated offset position (from audio start)
            preutterance: Estimated preutterance position (from audio start)
            params: Optional alignment params for default overlap ratio.
                   If not provided, uses module-level defaults.
            consonant_phoneme: Optional base phoneme string (e.g., "k", "sh")
                   for consonant-type-aware overlap ratio selection. If None
                   or not found in the lookup table, falls back to the ratio
                   from params.

        Returns:
            Estimated overlap position in milliseconds (from audio start)
        """
        # Determine overlap ratio: consonant-type-aware lookup, then fallback
        default_ratio = params.overlap_ratio if params else OVERLAP_RATIO

        if consonant_phoneme is not None:
            overlap_ratio = CONSONANT_OVERLAP_RATIOS.get(
                consonant_phoneme, default_ratio
            )
        else:
            overlap_ratio = default_ratio

        # Overlap is typically positioned between offset and preutterance
        # Use overlap_ratio to position it partway between them
        if preutterance <= offset:
            # Edge case: preutterance at or before offset
            return offset

        # Position overlap at overlap_ratio of the way from offset to preutterance
        overlap = offset + (preutterance - offset) * overlap_ratio

        return overlap

    def _estimate_cutoff(
        self,
        audio_duration_ms: float,
        segments: list[PhonemeSegment],
        params: AlignmentParams | None = None,
    ) -> float:
        """Find where to cut off (detect trailing silence).

        Returns a negative value representing milliseconds from audio end.

        Args:
            audio_duration_ms: Total audio duration
            segments: List of detected phoneme segments
            params: Optional alignment params for padding values.
                   If not provided, uses module-level defaults.

        Returns:
            Estimated cutoff in milliseconds (negative)
        """
        if not segments:
            return -DEFAULT_CUTOFF_PADDING_MS

        # Use params or fall back to module-level constants
        cutoff_padding = params.cutoff_padding_ms if params else CUTOFF_PADDING_MS
        min_confidence = (
            params.min_confidence_threshold if params else MIN_CONFIDENCE_THRESHOLD
        )

        # Find the last segment with reasonable confidence
        last_segment = None
        for segment in reversed(segments):
            if segment.confidence >= min_confidence:
                last_segment = segment
                break

        if last_segment is None:
            last_segment = segments[-1]

        # Calculate cutoff as negative offset from end
        # Add padding after last phoneme
        sound_end = last_segment.end_ms + cutoff_padding

        # Cutoff is negative, representing distance from audio end
        cutoff = -(audio_duration_ms - sound_end)

        # Ensure cutoff is negative and reasonable
        # If sound extends very close to end, use small negative value
        return min(cutoff, -10)

    def _calculate_confidence(
        self, segments: list[PhonemeSegment], audio_duration_ms: float
    ) -> float:
        """Calculate overall confidence in the suggestion.

        For UTAU voicebank samples (sustained vowels), the key indicators are:
        - Coverage: How much of the audio is covered by detected segments
        - Segment consistency: Segments should be contiguous and ordered
        - Raw detection confidence: Used as a minor factor

        The raw FA confidence is often low for sustained vowels (model expects
        short phonemes), so we prioritize coverage as the main quality signal.

        A low-confidence penalty is applied when the average raw FA confidence
        is below 0.1. This prevents genuinely bad alignments (where the aligner
        itself is very uncertain) from scoring highly due to good coverage and
        consistency alone. The penalty scales linearly from a 50% reduction at
        confidence 0.0 to no reduction at confidence 0.1.

        Args:
            segments: List of detected phoneme segments
            audio_duration_ms: Total audio duration

        Returns:
            Overall confidence score (0-1)
        """
        if not segments:
            return 0.0

        # Factor 1: Coverage of audio (most important for UTAU samples)
        # Energy-extended segments should cover most of the sound
        total_segment_duration = sum(s.duration_ms for s in segments)
        coverage = (
            min(1.0, total_segment_duration / audio_duration_ms)
            if audio_duration_ms > 0
            else 0
        )

        # Coverage scoring: 70%+ is good, 50-70% is acceptable
        if coverage >= 0.7:
            coverage_score = 0.9 + (coverage - 0.7) * 0.33  # 0.9-1.0
        elif coverage >= 0.5:
            coverage_score = 0.6 + (coverage - 0.5) * 1.5  # 0.6-0.9
        else:
            coverage_score = coverage * 1.2  # 0.0-0.6

        # Factor 2: Segment consistency (are segments properly ordered/non-overlapping?)
        consistency_score = 1.0
        for i in range(1, len(segments)):
            if segments[i].start_ms < segments[i - 1].end_ms:
                # Overlapping segments reduce confidence
                consistency_score *= 0.9
            if segments[i].start_ms < segments[i - 1].start_ms:
                # Out-of-order segments significantly reduce confidence
                consistency_score *= 0.7

        # Factor 3: Raw detection confidence (minor factor)
        # This is often low for sustained vowels, so we weight it less.
        # Note: The normalization floors at 0.0 (raw_score is always >= 0),
        # but very low raw confidence (< 0.1) triggers a separate penalty
        # after the weighted combination to cap the final score.
        avg_raw_confidence = float(np.mean([s.confidence for s in segments]))
        # Normalize: FA confidence of 0.3+ is considered good
        raw_score = min(1.0, avg_raw_confidence / 0.3)

        # Weighted combination: coverage is primary, raw confidence is secondary
        confidence = coverage_score * 0.6 + consistency_score * 0.25 + raw_score * 0.15

        # Low-confidence penalty: if the aligner itself is very uncertain
        # (avg_raw_confidence < 0.1), scale down the final score to prevent
        # bad alignments from appearing confident due to high coverage.
        # Scales linearly: 0.0 raw -> 50% penalty, 0.1 raw -> no penalty.
        if avg_raw_confidence < 0.1:
            confidence *= max(0.5, avg_raw_confidence / 0.1)

        return min(1.0, max(0.0, confidence))


# Module-level singleton
_default_suggester: OtoSuggester | None = None


def get_oto_suggester(
    use_forced_alignment: bool = True,
    use_sofa: bool = True,
    alignment_config: AlignmentConfig | None = None,
) -> OtoSuggester:
    """Get the default oto suggester singleton.

    Args:
        use_forced_alignment: If True, attempt MMS_FA forced alignment.
                              Falls back to defaults on failure.
                              Defaults to True.
        use_sofa: If True, attempt SOFA (Singing-Oriented Forced Aligner) first.
                  SOFA is optimized for singing voice and produces better results
                  for sustained vowels. Defaults to True.
        alignment_config: Optional AlignmentConfig for controlling alignment
                         parameters. If not provided, uses default config.

    Returns:
        OtoSuggester instance

    Note:
        The singleton is created on first call. Subsequent calls return the
        same instance regardless of parameters. To use different settings,
        create a new OtoSuggester instance directly.
    """
    global _default_suggester

    if _default_suggester is None:
        _default_suggester = OtoSuggester(
            use_forced_alignment=use_forced_alignment,
            use_sofa=use_sofa,
            alignment_config=alignment_config,
        )

    return _default_suggester
