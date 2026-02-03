"""Auto-oto suggestion using ML phoneme detection results."""

import logging
from pathlib import Path

import numpy as np

from src.backend.domain.alignment_config import AlignmentConfig, AlignmentParams
from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_alignment_detector import (
    ForcedAlignmentDetector,
    ForcedAlignmentError,
    TranscriptExtractionError,
    extract_transcript_from_filename,
    get_forced_alignment_detector,
)
from src.backend.ml.phoneme_detector import PhonemeDetector, preprocess_audio
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

# Overlap ratio relative to preutterance
OVERLAP_RATIO = 0.4

# Consonant extension into vowel region ratio
CONSONANT_VOWEL_EXTENSION_RATIO = 0.3


class OtoSuggester:
    """Suggests oto parameters from phoneme detection results.

    Uses ML-detected phoneme boundaries to automatically estimate
    initial oto.ini parameters for voicebank samples.

    Supports multiple detection modes:
    - SOFA alignment: Optimized for singing voice (enabled with use_sofa=True)
    - Forced alignment (default): Higher accuracy using expected phonemes from filename
    - Blind detection: Fallback using Wav2Vec2 phoneme recognition
    """

    def __init__(
        self,
        phoneme_detector: PhonemeDetector | None = None,
        use_forced_alignment: bool = True,
        use_sofa: bool = False,
        alignment_config: AlignmentConfig | None = None,
    ):
        """Initialize the oto suggester.

        Args:
            phoneme_detector: PhonemeDetector instance for blind phoneme detection.
                             Loaded lazily if not provided.
            use_forced_alignment: If True, attempt forced alignment first for higher
                                  accuracy. Falls back to blind detection on failure.
                                  Defaults to True.
            use_sofa: If True, attempt SOFA (Singing-Oriented Forced Aligner) first.
                     SOFA is optimized for singing voice and produces better results
                     for sustained vowels. Falls back to forced alignment if unavailable.
                     Defaults to False.
            alignment_config: Optional AlignmentConfig for controlling alignment
                             parameters. If not provided, uses default config.
        """
        self._phoneme_detector = phoneme_detector
        self._forced_alignment_detector: ForcedAlignmentDetector | None = None
        self._sofa_aligner: SOFAForcedAligner | None = None
        self.use_forced_alignment = use_forced_alignment
        self.use_sofa = use_sofa
        self._alignment_config = alignment_config or AlignmentConfig()

    @property
    def phoneme_detector(self) -> PhonemeDetector:
        """Get the phoneme detector, loading lazily if needed."""
        if self._phoneme_detector is None:
            from src.backend.ml.phoneme_detector import get_phoneme_detector

            self._phoneme_detector = get_phoneme_detector()
        return self._phoneme_detector

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
        try_blind = True

        if method_override == "sofa":
            try_fa = False
            try_blind = False
        elif method_override == "fa":
            try_sofa = False
            try_blind = False
        elif method_override == "blind":
            try_sofa = False
            try_fa = False

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
                    "Falling back to forced alignment."
                )
            except AlignmentError as e:
                logger.warning(
                    f"SOFA alignment failed for {filename}, "
                    f"falling back to forced alignment: {e}"
                )

        # Try forced alignment if SOFA didn't work and forced alignment is enabled
        if not segments and try_fa:
            try:
                detection_result = await self.forced_alignment_detector.detect_phonemes(
                    audio_path, alignment_params=params
                )
                segments = detection_result.segments
                audio_duration_ms = detection_result.audio_duration_ms
                detection_method = "forced_alignment"
                logger.info(
                    f"Forced alignment succeeded for {filename}: "
                    f"{len(segments)} segments detected"
                )
            except (ForcedAlignmentError, TranscriptExtractionError) as e:
                logger.warning(
                    f"Forced alignment failed for {filename}, "
                    f"falling back to blind detection: {e}"
                )

        # Fall back to blind detection if forced alignment failed or is disabled
        if not segments and try_blind:
            try:
                detection_result = await self.phoneme_detector.detect_phonemes(
                    audio_path
                )
                segments = detection_result.segments
                audio_duration_ms = detection_result.audio_duration_ms
                detection_method = "blind_detection"
                logger.info(
                    f"Blind detection used for {filename}: "
                    f"{len(segments)} segments detected"
                )
            except Exception as e:
                logger.warning(f"Phoneme detection failed, using defaults: {e}")
                # Fall back to loading audio duration manually
                _, _, audio_duration_ms = preprocess_audio(audio_path)
                segments = []
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
            overlap = self._estimate_overlap(offset, preutterance, params)
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
    ) -> list[OtoSuggestion]:
        """Analyze multiple audio files and suggest oto parameters in batch.

        When SOFA is enabled and available, this is much faster than calling
        suggest_oto() repeatedly because the model is loaded only once.

        Args:
            audio_paths: List of paths to WAV files
            aliases: Optional list of aliases (same length as audio_paths).
                    If None, aliases are generated from filenames.
            sofa_language: Language code for SOFA alignment (ja, en, zh, ko, fr)

        Returns:
            List of OtoSuggestion objects (same order as input paths)
        """
        if not audio_paths:
            return []

        # Validate aliases length if provided
        if aliases is not None and len(aliases) != len(audio_paths):
            raise ValueError(
                f"aliases length ({len(aliases)}) must match "
                f"audio_paths length ({len(audio_paths)})"
            )

        # If SOFA is not enabled or not available, fall back to sequential processing
        if not self.use_sofa or not is_sofa_available():
            logger.info(
                "SOFA not available for batch processing, "
                "falling back to sequential suggest_oto() calls"
            )
            return await self._batch_suggest_sequential(
                audio_paths, aliases, sofa_language
            )

        # Extract transcripts and prepare items for batch alignment
        items: list[tuple[Path, str]] = []
        path_to_transcript: dict[Path, str] = {}

        for audio_path in audio_paths:
            filename = audio_path.name
            try:
                transcript = extract_transcript_from_filename(filename)
                items.append((audio_path, transcript))
                path_to_transcript[audio_path] = transcript
            except TranscriptExtractionError as e:
                logger.warning(
                    f"Failed to extract transcript from {filename}: {e}. "
                    "Will process individually."
                )
                # Keep track but don't add to batch items
                path_to_transcript[audio_path] = ""

        # Filter to only files with valid transcripts for batch processing
        batch_items = [(p, t) for p, t in items if t]

        # Run batch alignment with SOFA
        alignment_results: dict[Path, AlignmentResult] = {}
        if batch_items:
            try:
                alignment_results = await self.sofa_aligner.batch_align(
                    batch_items, language=sofa_language
                )
                logger.info(
                    f"SOFA batch alignment succeeded for "
                    f"{len(alignment_results)}/{len(batch_items)} files"
                )
            except AlignmentError as e:
                logger.warning(
                    f"SOFA batch alignment failed: {e}. "
                    "Falling back to sequential processing."
                )
                return await self._batch_suggest_sequential(
                    audio_paths, aliases, sofa_language
                )

        # Build suggestions from alignment results
        suggestions: list[OtoSuggestion] = []
        failed_paths: list[tuple[int, Path]] = []  # (index, path) for fallback

        for idx, audio_path in enumerate(audio_paths):
            filename = audio_path.name

            # Determine alias for this file
            if aliases is not None:
                alias = aliases[idx]
            else:
                alias = self._generate_alias_from_filename(filename)

            # Check if we have alignment result for this file
            if audio_path in alignment_results:
                result = alignment_results[audio_path]
                suggestion = self._build_suggestion_from_alignment(
                    filename=filename,
                    alias=alias,
                    segments=result.segments,
                    audio_duration_ms=result.audio_duration_ms,
                    detection_method="sofa",
                )
                suggestions.append(suggestion)
            else:
                # Mark for fallback processing
                failed_paths.append((idx, audio_path))
                suggestions.append(None)  # type: ignore[arg-type] # Placeholder

        # Process failed files individually using suggest_oto()
        if failed_paths:
            logger.info(
                f"Processing {len(failed_paths)} files that failed batch alignment"
            )
            for idx, audio_path in failed_paths:
                file_alias = aliases[idx] if aliases is not None else None
                try:
                    suggestion = await self.suggest_oto(
                        audio_path, alias=file_alias, sofa_language=sofa_language
                    )
                    suggestions[idx] = suggestion
                except Exception as e:
                    logger.error(f"Failed to process {audio_path}: {e}")
                    # Create a default suggestion
                    suggestions[idx] = self._build_default_suggestion(
                        audio_path, file_alias
                    )

        return suggestions

    async def _batch_suggest_sequential(
        self,
        audio_paths: list[Path],
        aliases: list[str] | None,
        sofa_language: str,
    ) -> list[OtoSuggestion]:
        """Process files sequentially when batch processing is not available.

        Args:
            audio_paths: List of paths to WAV files
            aliases: Optional list of aliases
            sofa_language: Language code for SOFA alignment

        Returns:
            List of OtoSuggestion objects
        """
        suggestions: list[OtoSuggestion] = []

        for idx, audio_path in enumerate(audio_paths):
            file_alias = aliases[idx] if aliases is not None else None
            try:
                suggestion = await self.suggest_oto(
                    audio_path, alias=file_alias, sofa_language=sofa_language
                )
                suggestions.append(suggestion)
            except Exception as e:
                logger.error(f"Failed to process {audio_path}: {e}")
                suggestions.append(
                    self._build_default_suggestion(audio_path, file_alias)
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
            overlap = self._estimate_overlap(offset, preutterance, params)
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

    def _build_default_suggestion(
        self,
        audio_path: Path,
        alias: str | None,
    ) -> OtoSuggestion:
        """Build a default OtoSuggestion when all detection methods fail.

        Args:
            audio_path: Path to the audio file
            alias: Optional alias override

        Returns:
            OtoSuggestion with default parameters
        """
        filename = audio_path.name

        if alias is None:
            alias = self._generate_alias_from_filename(filename)

        # Try to get audio duration
        try:
            _, _, audio_duration_ms = preprocess_audio(audio_path)
        except Exception:
            audio_duration_ms = 1000.0  # Default 1 second

        return OtoSuggestion(
            filename=filename,
            alias=alias,
            offset=DEFAULT_OFFSET_MS,
            consonant=DEFAULT_CONSONANT_MS,
            cutoff=-DEFAULT_CUTOFF_PADDING_MS,
            preutterance=DEFAULT_PREUTTERANCE_MS,
            overlap=DEFAULT_OVERLAP_MS,
            confidence=0.0,
            phonemes_detected=[],
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
                vowel_extension = first_vowel.duration_ms * cv_extension_ratio
                return last_consonant_before_vowel.end_ms + vowel_extension

            # No consonant before vowel - use vowel start + extension
            vowel_extension = first_vowel.duration_ms * cv_extension_ratio
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

    def _estimate_overlap(
        self,
        offset: float,
        preutterance: float,
        params: AlignmentParams | None = None,
    ) -> float:
        """Estimate overlap position (absolute position from audio start).

        Overlap is the position where crossfade with the previous note occurs,
        typically positioned between offset and preutterance.

        Args:
            offset: Estimated offset position (from audio start)
            preutterance: Estimated preutterance position (from audio start)
            params: Optional alignment params for overlap ratio.
                   If not provided, uses module-level defaults.

        Returns:
            Estimated overlap position in milliseconds (from audio start)
        """
        # Use params or fall back to module-level constant
        overlap_ratio = params.overlap_ratio if params else OVERLAP_RATIO

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
        # This is often low for sustained vowels, so we weight it less
        avg_raw_confidence = float(np.mean([s.confidence for s in segments]))
        # Normalize: FA confidence of 0.3+ is considered good
        raw_score = min(1.0, avg_raw_confidence / 0.3)

        # Weighted combination: coverage is primary, raw confidence is secondary
        confidence = coverage_score * 0.6 + consistency_score * 0.25 + raw_score * 0.15

        return min(1.0, max(0.0, confidence))


# Module-level singleton
_default_suggester: OtoSuggester | None = None


def get_oto_suggester(
    phoneme_detector: PhonemeDetector | None = None,
    use_forced_alignment: bool = True,
    use_sofa: bool = True,
    alignment_config: AlignmentConfig | None = None,
) -> OtoSuggester:
    """Get the default oto suggester singleton.

    Args:
        phoneme_detector: Optional phoneme detector to use for blind detection.
                         Loaded lazily if not provided.
        use_forced_alignment: If True, attempt forced alignment first for higher
                              accuracy. Falls back to blind detection on failure.
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
            phoneme_detector=phoneme_detector,
            use_forced_alignment=use_forced_alignment,
            use_sofa=use_sofa,
            alignment_config=alignment_config,
        )

    return _default_suggester
