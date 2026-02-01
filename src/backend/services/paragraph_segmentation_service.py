"""Service for segmenting paragraph recordings into individual phoneme samples.

Processes recorded paragraphs using forced alignment (MFA/Wav2Vec2) to extract
individual phoneme samples from natural sentences. This enables efficient
voicebank recording where users record full sentences rather than individual
phonemes, and ML extracts the phoneme samples automatically.
"""

import logging
from pathlib import Path
from uuid import UUID

import librosa
import numpy as np
import soundfile as sf
from pydantic import BaseModel, ConfigDict, Field

from src.backend.domain.paragraph_prompt import ParagraphPrompt, Word
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_aligner import (
    AlignmentError,
    AlignmentResult,
    get_forced_aligner,
)
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionNotFoundError,
)

logger = logging.getLogger(__name__)

# UTAU standard sample rate
UTAU_SAMPLE_RATE = 44100

# Default padding around phoneme boundaries (ms)
DEFAULT_PADDING_MS = 15.0


class ExtractedSample(BaseModel):
    """A single phoneme sample extracted from a paragraph recording.

    Represents an individual phoneme extracted from a larger audio file,
    including its source context and alignment information.
    """

    phoneme: str = Field(
        description="The phoneme extracted (e.g., 'ka', 'a')",
        min_length=1,
    )
    source_word: str = Field(
        description="The word this phoneme came from (e.g., 'akai')",
    )
    start_ms: float = Field(
        ge=0,
        description="Start time in the original audio (ms)",
    )
    end_ms: float = Field(
        ge=0,
        description="End time in the original audio (ms)",
    )
    output_path: Path = Field(
        description="Path to the extracted WAV file",
    )
    duration_ms: float = Field(
        ge=0,
        description="Duration of the extracted sample (ms)",
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Alignment confidence score",
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)


class ParagraphSegmentationResult(BaseModel):
    """Result of segmenting a paragraph recording into phoneme samples.

    Contains the alignment data, extracted samples, and coverage information
    for a single paragraph recording.
    """

    paragraph_id: str = Field(
        description="Original paragraph prompt ID",
    )
    audio_path: Path = Field(
        description="Path to the original recording",
    )
    alignment: dict = Field(
        description="MFA alignment result (word + phoneme boundaries)",
    )
    extracted_samples: list[ExtractedSample] = Field(
        default_factory=list,
        description="List of extracted phoneme samples",
    )
    coverage_achieved: list[str] = Field(
        default_factory=list,
        description="List of phonemes successfully extracted",
    )
    coverage_missing: list[str] = Field(
        default_factory=list,
        description="List of expected phonemes not found",
    )
    success: bool = Field(
        default=True,
        description="Whether segmentation succeeded",
    )
    errors: list[str] = Field(
        default_factory=list,
        description="List of error messages",
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)


class SegmentationError(Exception):
    """Base error for segmentation operations."""

    pass


# IPA to Romaji phoneme mappings for Japanese
# MFA outputs IPA, we need to convert to romaji for UTAU compatibility
IPA_TO_ROMAJI: dict[str, str] = {
    # Vowels
    "a": "a",
    "i": "i",
    "u": "u",
    "e": "e",
    "o": "o",
    # Long vowels (IPA uses length marker)
    "a:": "aa",
    "i:": "ii",
    "u:": "uu",
    "e:": "ee",
    "o:": "oo",
    # Consonants + vowels (basic CV)
    "ka": "ka",
    "ki": "ki",
    "ku": "ku",
    "ke": "ke",
    "ko": "ko",
    "sa": "sa",
    "si": "si",
    "su": "su",
    "se": "se",
    "so": "so",
    "ta": "ta",
    "ti": "ti",
    "tu": "tu",
    "te": "te",
    "to": "to",
    "na": "na",
    "ni": "ni",
    "nu": "nu",
    "ne": "ne",
    "no": "no",
    "ha": "ha",
    "hi": "hi",
    "hu": "hu",
    "he": "he",
    "ho": "ho",
    "ma": "ma",
    "mi": "mi",
    "mu": "mu",
    "me": "me",
    "mo": "mo",
    "ya": "ya",
    "yu": "yu",
    "yo": "yo",
    "ra": "ra",
    "ri": "ri",
    "ru": "ru",
    "re": "re",
    "ro": "ro",
    "wa": "wa",
    "wo": "wo",
    "n": "n",
    # IPA-specific consonants
    "k": "k",
    "s": "s",
    "t": "t",
    "h": "h",
    "m": "m",
    "j": "y",
    "r": "r",
    "w": "w",
    "g": "g",
    "z": "z",
    "d": "d",
    "b": "b",
    "p": "p",
    # Palatalized consonants
    "kj": "ky",
    "sj": "sh",
    "tj": "ch",
    "nj": "ny",
    "hj": "hy",
    "mj": "my",
    "rj": "ry",
    "gj": "gy",
    "zj": "j",
    "dj": "j",
    "bj": "by",
    "pj": "py",
    # Special sounds
    "ts": "ts",
    "tsu": "tsu",
    "chi": "chi",
    "shi": "shi",
    "fu": "fu",
    # Geminate marker (small tsu)
    "Q": "っ",
    "q": "っ",
    # Syllabic n
    "N": "n",
    # Voiced consonants
    "ga": "ga",
    "gi": "gi",
    "gu": "gu",
    "ge": "ge",
    "go": "go",
    "za": "za",
    "zi": "zi",
    "zu": "zu",
    "ze": "ze",
    "zo": "zo",
    "da": "da",
    "di": "di",
    "du": "du",
    "de": "de",
    "do": "do",
    "ba": "ba",
    "bi": "bi",
    "bu": "bu",
    "be": "be",
    "bo": "bo",
    "pa": "pa",
    "pi": "pi",
    "pu": "pu",
    "pe": "pe",
    "po": "po",
}


def ipa_to_romaji(ipa_phoneme: str) -> str:
    """Convert an IPA phoneme to romaji.

    Args:
        ipa_phoneme: IPA phoneme string

    Returns:
        Romaji equivalent, or original if no mapping found
    """
    # Direct mapping
    if ipa_phoneme.lower() in IPA_TO_ROMAJI:
        return IPA_TO_ROMAJI[ipa_phoneme.lower()]

    # Try without diacritics
    cleaned = ipa_phoneme.replace(":", "").replace("ː", "")
    if cleaned.lower() in IPA_TO_ROMAJI:
        return IPA_TO_ROMAJI[cleaned.lower()]

    # Return as-is if no mapping
    return ipa_phoneme.lower()


def levenshtein_distance(s1: str, s2: str) -> int:
    """Calculate Levenshtein distance between two strings.

    Args:
        s1: First string
        s2: Second string

    Returns:
        Edit distance between strings
    """
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)

    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def fuzzy_phoneme_match(detected: str, expected: str, threshold: int = 2) -> bool:
    """Check if detected phoneme fuzzy-matches expected phoneme.

    Args:
        detected: Detected phoneme from alignment
        expected: Expected phoneme from prompt
        threshold: Maximum edit distance for match

    Returns:
        True if phonemes match within threshold
    """
    # Direct match
    if detected.lower() == expected.lower():
        return True

    # Convert IPA to romaji and compare
    romaji = ipa_to_romaji(detected)
    if romaji.lower() == expected.lower():
        return True

    # Fuzzy match with Levenshtein
    return levenshtein_distance(romaji.lower(), expected.lower()) <= threshold


class ParagraphSegmentationService:
    """Service for segmenting paragraph recordings into phoneme samples.

    Uses forced alignment (MFA or Wav2Vec2) to identify phoneme boundaries
    in recorded sentences, then extracts individual phoneme samples as
    separate WAV files for use in UTAU voicebanks.
    """

    def __init__(
        self,
        session_service: RecordingSessionService | None = None,
        prefer_mfa: bool = True,
        padding_ms: float = DEFAULT_PADDING_MS,
    ) -> None:
        """Initialize segmentation service.

        Args:
            session_service: Recording session service for accessing recordings
            prefer_mfa: If True, prefer MFA when available
            padding_ms: Padding to add around phoneme boundaries (ms)
        """
        self._session_service = session_service
        self._prefer_mfa = prefer_mfa
        self._padding_ms = padding_ms

    async def segment_paragraph(
        self,
        audio_path: Path,
        paragraph: ParagraphPrompt,
        output_dir: Path,
    ) -> ParagraphSegmentationResult:
        """Segment a paragraph recording into individual phoneme samples.

        1. Run MFA alignment on the audio with paragraph.romaji
        2. Map aligned phonemes to expected phonemes from paragraph.words
        3. Extract each phoneme's audio as a separate WAV file
        4. Return results with coverage info

        Args:
            audio_path: Path to the recorded paragraph audio (WAV)
            paragraph: ParagraphPrompt with expected phonemes and words
            output_dir: Directory to save extracted samples

        Returns:
            ParagraphSegmentationResult with alignment and extracted samples

        Raises:
            SegmentationError: If segmentation fails
        """
        errors: list[str] = []
        extracted_samples: list[ExtractedSample] = []

        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)

        # Step 1: Run forced alignment
        try:
            aligner = get_forced_aligner(self._prefer_mfa)
            alignment_result: AlignmentResult = await aligner.align(
                audio_path=audio_path,
                transcript=paragraph.romaji,
                language=paragraph.language,
            )
        except AlignmentError as e:
            logger.error(f"Alignment failed for {paragraph.id}: {e}")
            return ParagraphSegmentationResult(
                paragraph_id=paragraph.id,
                audio_path=audio_path,
                alignment={},
                extracted_samples=[],
                coverage_achieved=[],
                coverage_missing=paragraph.expected_phonemes,
                success=False,
                errors=[f"Alignment failed: {e}"],
            )

        # Step 2: Map aligned phonemes to expected phonemes
        phoneme_mappings = self._map_phonemes_to_words(
            alignment_result.segments,
            alignment_result.word_segments,
            paragraph.words,
        )

        # Step 3: Extract audio for each mapped phoneme
        for mapping in phoneme_mappings:
            try:
                sample = await self._extract_phoneme_audio(
                    audio_path=audio_path,
                    phoneme=mapping["expected_phoneme"],
                    source_word=mapping["source_word"],
                    start_ms=mapping["start_ms"],
                    end_ms=mapping["end_ms"],
                    confidence=mapping["confidence"],
                    output_dir=output_dir,
                )
                extracted_samples.append(sample)
            except Exception as e:
                error_msg = f"Failed to extract '{mapping['expected_phoneme']}': {e}"
                logger.warning(error_msg)
                errors.append(error_msg)

        # Step 4: Calculate coverage
        achieved_phonemes = list({s.phoneme for s in extracted_samples})
        expected_set = set(paragraph.expected_phonemes)
        achieved_set = set(achieved_phonemes)
        missing_phonemes = sorted(expected_set - achieved_set)

        success = len(errors) == 0 and len(achieved_phonemes) > 0

        return ParagraphSegmentationResult(
            paragraph_id=paragraph.id,
            audio_path=audio_path,
            alignment=alignment_result.to_dict(),
            extracted_samples=extracted_samples,
            coverage_achieved=sorted(achieved_phonemes),
            coverage_missing=missing_phonemes,
            success=success,
            errors=errors,
        )

    async def segment_session(
        self,
        session_id: UUID,
        output_dir: Path,
        paragraph_library: dict[str, ParagraphPrompt] | None = None,
    ) -> list[ParagraphSegmentationResult]:
        """Process all paragraphs in a recording session.

        Args:
            session_id: Recording session UUID
            output_dir: Base directory for extracted samples
            paragraph_library: Optional mapping of paragraph_id -> ParagraphPrompt
                               If not provided, will attempt to reconstruct from session

        Returns:
            List of segmentation results for each paragraph

        Raises:
            SessionNotFoundError: If session not found
            SegmentationError: If session is not paragraph mode
        """
        if self._session_service is None:
            raise SegmentationError(
                "Session service required for session-based segmentation"
            )

        session = await self._session_service.get(session_id)

        # Verify this is a paragraph-mode session
        if session.recording_mode != "paragraph":
            raise SegmentationError(
                f"Session {session_id} is not in paragraph mode "
                f"(mode: {session.recording_mode})"
            )

        if not session.paragraph_ids:
            raise SegmentationError(f"Session {session_id} has no paragraph IDs")

        results: list[ParagraphSegmentationResult] = []

        for segment in session.segments:
            if not segment.is_accepted:
                continue

            # Get paragraph prompt for this segment
            paragraph_id = (
                session.paragraph_ids[segment.prompt_index]
                if segment.prompt_index < len(session.paragraph_ids)
                else None
            )

            if not paragraph_id:
                logger.warning(
                    f"No paragraph ID for segment {segment.id} at index {segment.prompt_index}"
                )
                continue

            if paragraph_library and paragraph_id in paragraph_library:
                paragraph = paragraph_library[paragraph_id]
            else:
                # Create a minimal paragraph prompt from session data
                paragraph = self._create_minimal_paragraph(
                    paragraph_id=paragraph_id,
                    prompt_text=segment.prompt_text,
                    language=session.language,
                    style=session.recording_style,
                )

            # Get audio path
            try:
                audio_path = await self._session_service.get_segment_audio_path(
                    session_id, segment.audio_filename
                )
            except SessionNotFoundError as e:
                logger.warning(f"Audio not found for segment {segment.id}: {e}")
                continue

            # Segment the paragraph
            segment_output_dir = output_dir / paragraph_id
            result = await self.segment_paragraph(
                audio_path=audio_path,
                paragraph=paragraph,
                output_dir=segment_output_dir,
            )
            results.append(result)

        return results

    def _map_phonemes_to_words(
        self,
        phoneme_segments: list[PhonemeSegment],
        word_segments: list[dict],
        words: list[Word],
    ) -> list[dict]:
        """Map aligned phonemes to expected phonemes from words.

        Uses word boundaries and phoneme timing to match aligned phonemes
        with expected phonemes from the paragraph prompt.

        Args:
            phoneme_segments: Phoneme segments from alignment
            word_segments: Word segments from alignment
            words: Expected words with phoneme breakdowns

        Returns:
            List of mappings with phoneme info and timing
        """
        mappings: list[dict] = []

        # Create a lookup of word boundaries
        word_boundaries: list[tuple[str, float, float]] = []
        for ws in word_segments:
            word_boundaries.append(
                (
                    ws.get("word", ""),
                    ws.get("start_ms", 0),
                    ws.get("end_ms", 0),
                )
            )

        # Track which expected phonemes we've mapped
        phoneme_index = 0

        for word in words:
            # Find matching word boundary
            word_start_ms = 0.0
            word_end_ms = 0.0
            word_found = False

            for w_text, w_start, w_end in word_boundaries:
                if self._words_match(w_text, word.romaji):
                    word_start_ms = w_start
                    word_end_ms = w_end
                    word_found = True
                    break

            if not word_found:
                # Use phoneme timing to estimate word boundaries
                word_start_ms = None
                word_end_ms = None

            # Map phonemes for this word
            for expected_phoneme in word.phonemes:
                # Find phoneme segment that matches
                best_match = None
                best_confidence = 0.0

                for segment in phoneme_segments:
                    if phoneme_index < len(phoneme_segments):
                        # Check if this segment falls within word boundaries
                        in_word = True
                        if word_start_ms is not None and word_end_ms is not None:
                            in_word = (
                                segment.start_ms >= word_start_ms - self._padding_ms
                                and segment.end_ms <= word_end_ms + self._padding_ms
                            )

                        if (
                            in_word
                            and fuzzy_phoneme_match(segment.phoneme, expected_phoneme)
                            and segment.confidence > best_confidence
                        ):
                            best_match = segment
                            best_confidence = segment.confidence

                if best_match:
                    mappings.append(
                        {
                            "expected_phoneme": expected_phoneme,
                            "detected_phoneme": best_match.phoneme,
                            "source_word": word.romaji,
                            "start_ms": best_match.start_ms,
                            "end_ms": best_match.end_ms,
                            "confidence": best_match.confidence,
                        }
                    )
                    phoneme_index += 1
                else:
                    # Try sequential matching as fallback
                    if phoneme_index < len(phoneme_segments):
                        segment = phoneme_segments[phoneme_index]
                        mappings.append(
                            {
                                "expected_phoneme": expected_phoneme,
                                "detected_phoneme": segment.phoneme,
                                "source_word": word.romaji,
                                "start_ms": segment.start_ms,
                                "end_ms": segment.end_ms,
                                "confidence": segment.confidence
                                * 0.5,  # Lower confidence
                            }
                        )
                        phoneme_index += 1

        return mappings

    def _words_match(self, detected: str, expected: str) -> bool:
        """Check if detected word matches expected word.

        Args:
            detected: Word from alignment
            expected: Expected word (romaji)

        Returns:
            True if words match
        """
        # Normalize for comparison
        d = detected.lower().strip()
        e = expected.lower().strip()

        # Direct match
        if d == e:
            return True

        # Remove spaces and compare
        if d.replace(" ", "") == e.replace(" ", ""):
            return True

        # Fuzzy match for small differences
        return levenshtein_distance(d, e) <= 2

    async def _extract_phoneme_audio(
        self,
        audio_path: Path,
        phoneme: str,
        source_word: str,
        start_ms: float,
        end_ms: float,
        confidence: float,
        output_dir: Path,
    ) -> ExtractedSample:
        """Extract a phoneme's audio segment as a separate WAV file.

        Args:
            audio_path: Source audio file
            phoneme: Phoneme being extracted
            source_word: Word the phoneme comes from
            start_ms: Start time in source audio
            end_ms: End time in source audio
            confidence: Alignment confidence
            output_dir: Directory for output file

        Returns:
            ExtractedSample with output path and metadata
        """
        # Add padding around boundaries
        padded_start_ms = max(0, start_ms - self._padding_ms)
        padded_end_ms = end_ms + self._padding_ms

        # Load audio
        audio, sr = librosa.load(str(audio_path), sr=None, mono=True)
        audio_duration_ms = (len(audio) / sr) * 1000

        # Clamp end time to audio duration
        padded_end_ms = min(padded_end_ms, audio_duration_ms)

        # Convert ms to samples
        start_sample = int((padded_start_ms / 1000) * sr)
        end_sample = int((padded_end_ms / 1000) * sr)

        # Extract segment
        segment_audio = audio[start_sample:end_sample]

        # Normalize audio
        max_val = np.max(np.abs(segment_audio))
        if max_val > 0:
            segment_audio = segment_audio / max_val * 0.95  # Leave headroom

        # Resample to UTAU standard if needed
        if sr != UTAU_SAMPLE_RATE:
            segment_audio = librosa.resample(
                segment_audio, orig_sr=sr, target_sr=UTAU_SAMPLE_RATE
            )

        # Generate output filename
        safe_phoneme = phoneme.replace("/", "_").replace("\\", "_").replace(" ", "_")
        filename = f"{safe_phoneme}_{source_word}_{int(start_ms)}.wav"
        output_path = output_dir / filename

        # Save as WAV
        output_dir.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), segment_audio, UTAU_SAMPLE_RATE)

        duration_ms = padded_end_ms - padded_start_ms

        return ExtractedSample(
            phoneme=phoneme,
            source_word=source_word,
            start_ms=padded_start_ms,
            end_ms=padded_end_ms,
            output_path=output_path,
            duration_ms=duration_ms,
            confidence=confidence,
        )

    def _create_minimal_paragraph(
        self,
        paragraph_id: str,
        prompt_text: str,
        language: str,
        style: str,
    ) -> ParagraphPrompt:
        """Create a minimal ParagraphPrompt from session data.

        Used when full paragraph library is not available.

        Args:
            paragraph_id: Paragraph identifier
            prompt_text: The prompt text (romaji)
            language: Language code
            style: Recording style

        Returns:
            Minimal ParagraphPrompt for segmentation
        """
        # Parse words from space-separated romaji
        word_texts = prompt_text.split()
        words: list[Word] = []
        char_pos = 0

        for word_text in word_texts:
            # Simple phoneme extraction - split into CV units
            phonemes = self._extract_basic_phonemes(word_text)
            words.append(
                Word(
                    text=word_text,
                    romaji=word_text,
                    phonemes=phonemes,
                    start_char=char_pos,
                )
            )
            char_pos += len(word_text) + 1  # +1 for space

        all_phonemes = []
        for w in words:
            all_phonemes.extend(w.phonemes)

        return ParagraphPrompt(
            id=paragraph_id,
            text=prompt_text,
            romaji=prompt_text,
            words=words,
            expected_phonemes=list(set(all_phonemes)),
            style=style if style in ("cv", "vcv", "cvvc", "vccv", "arpasing") else "cv",
            language=language,
            category="auto-generated",
        )

    def _extract_basic_phonemes(self, word: str) -> list[str]:
        """Extract basic CV phonemes from a romaji word.

        This is a simplified extraction for when full phoneme data
        is not available. For better results, use a proper phoneme
        library.

        Args:
            word: Romaji word (e.g., "akai")

        Returns:
            List of phonemes (e.g., ["a", "ka", "i"])
        """
        phonemes: list[str] = []
        word = word.lower()
        i = 0

        # Japanese vowels
        vowels = set("aiueo")

        # Two-character consonant combinations
        two_char_consonants = {
            "sh",
            "ch",
            "ts",
            "ky",
            "gy",
            "ny",
            "hy",
            "my",
            "ry",
            "py",
            "by",
        }

        while i < len(word):
            # Check for two-character consonant + vowel (e.g., "sha", "chi")
            if i + 2 < len(word) and word[i : i + 2] in two_char_consonants:
                if word[i + 2] in vowels:
                    phonemes.append(word[i : i + 3])
                    i += 3
                    continue
                else:
                    # Just the consonant cluster
                    phonemes.append(word[i : i + 2])
                    i += 2
                    continue

            # Check for consonant + vowel (e.g., "ka", "sa")
            if i + 1 < len(word) and word[i] not in vowels and word[i + 1] in vowels:
                phonemes.append(word[i : i + 2])
                i += 2
                continue

            # Single vowel
            if word[i] in vowels:
                phonemes.append(word[i])
                i += 1
                continue

            # Special case: "n" at end or before consonant (syllabic n)
            if word[i] == "n" and (i + 1 >= len(word) or word[i + 1] not in vowels):
                phonemes.append("n")
                i += 1
                continue

            # Fallback: single character
            phonemes.append(word[i])
            i += 1

        return phonemes


# Module-level singleton
_segmentation_service: ParagraphSegmentationService | None = None


def get_paragraph_segmentation_service(
    session_service: RecordingSessionService | None = None,
    prefer_mfa: bool = True,
) -> ParagraphSegmentationService:
    """Get the paragraph segmentation service singleton.

    Args:
        session_service: Recording session service (optional)
        prefer_mfa: If True, prefer MFA when available

    Returns:
        ParagraphSegmentationService instance
    """
    global _segmentation_service

    if _segmentation_service is None:
        _segmentation_service = ParagraphSegmentationService(
            session_service=session_service,
            prefer_mfa=prefer_mfa,
        )

    return _segmentation_service
