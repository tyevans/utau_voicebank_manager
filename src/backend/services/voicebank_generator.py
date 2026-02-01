"""Service for generating complete UTAU voicebanks from aligned recording sessions.

This service orchestrates the pipeline from recorded audio segments to a
complete voicebank with sliced samples and oto.ini configuration.
"""

import logging
import time
from collections.abc import Callable
from pathlib import Path
from uuid import UUID

import numpy as np
from scipy.io import wavfile

from src.backend.domain.generated_voicebank import GeneratedVoicebank, SlicedSample
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.oto_suggester import OtoSuggester
from src.backend.services.alignment_service import (
    AlignmentService,
    SegmentAlignment,
)
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionNotFoundError,
)
from src.backend.utils.oto_parser import write_oto_file

logger = logging.getLogger(__name__)

# Audio processing constants
TARGET_SAMPLE_RATE = 44100  # UTAU standard sample rate
FADE_DURATION_MS = 5.0  # Fade in/out duration at slice boundaries
MIN_SAMPLE_DURATION_MS = 50.0  # Minimum viable sample duration


class VoicebankGeneratorError(Exception):
    """Base error for voicebank generation failures."""


class NoAlignedSegmentsError(VoicebankGeneratorError):
    """Raised when session has no aligned segments to process."""


class AudioProcessingError(VoicebankGeneratorError):
    """Raised when audio slicing or processing fails."""


class VoicebankGenerator:
    """Generates complete UTAU voicebanks from aligned recording sessions.

    Orchestrates the full pipeline:
    1. Load session with all segments
    2. Align segments (or use existing alignments)
    3. Slice audio at phoneme boundaries
    4. Generate sample filenames using style conventions
    5. Run oto suggester on sliced samples
    6. Compile oto.ini from all entries
    7. Create voicebank folder structure
    """

    def __init__(
        self,
        session_service: RecordingSessionService,
        alignment_service: AlignmentService,
        oto_suggester: OtoSuggester,
        output_base_path: Path,
    ) -> None:
        """Initialize the voicebank generator.

        Args:
            session_service: Service for accessing recording sessions
            alignment_service: Service for phoneme alignment
            oto_suggester: ML-based oto parameter suggester
            output_base_path: Base path for generated voicebanks
        """
        self._session_service = session_service
        self._alignment_service = alignment_service
        self._oto_suggester = oto_suggester
        self._output_base_path = output_base_path
        self._output_base_path.mkdir(parents=True, exist_ok=True)

    async def generate_from_session(
        self,
        session_id: UUID,
        voicebank_name: str,
        output_path: Path | None = None,
        include_character_txt: bool = True,
        encoding: str = "utf-8",
        progress_callback: Callable[[float, str], None] | None = None,
    ) -> GeneratedVoicebank:
        """Generate a complete voicebank from an aligned recording session.

        Pipeline:
        1. Load session with all segments and alignments
        2. For each aligned segment:
           - Slice audio at phoneme boundaries
           - Generate sample filenames (e.g., "_ka.wav", "_akasa.wav")
           - Run oto suggester on sliced audio
        3. Compile oto.ini from all entries
        4. Create voicebank folder structure:
           voicebank_name/
               oto.ini
               character.txt (optional metadata)
               *.wav (all samples)
        5. Return GeneratedVoicebank with stats

        Args:
            session_id: UUID of the recording session to process
            voicebank_name: Display name for the voicebank
            output_path: Optional custom output path (default: output_base_path/name)
            include_character_txt: Whether to create character.txt metadata
            encoding: Encoding for oto.ini (utf-8 or cp932)
            progress_callback: Optional callback(progress_pct, status_message)

        Returns:
            GeneratedVoicebank with generation statistics

        Raises:
            SessionNotFoundError: If session does not exist
            NoAlignedSegmentsError: If no segments could be aligned
            VoicebankGeneratorError: For other generation failures
        """
        start_time = time.time()
        warnings: list[str] = []
        skipped = 0

        def report_progress(pct: float, msg: str) -> None:
            if progress_callback:
                progress_callback(pct, msg)
            logger.info(f"[{pct:.1f}%] {msg}")

        report_progress(0, f"Loading session {session_id}")

        # Step 1: Load session
        try:
            session = await self._session_service.get(session_id)
        except SessionNotFoundError:
            raise

        report_progress(5, f"Loaded session with {len(session.segments)} segments")

        # Determine output path
        safe_name = self._sanitize_name(voicebank_name)
        if output_path is None:
            output_path = self._output_base_path / safe_name
        output_path.mkdir(parents=True, exist_ok=True)

        report_progress(10, "Aligning session segments")

        # Step 2: Align all segments
        alignment_result = await self._alignment_service.align_session(
            session_id, skip_rejected=True
        )

        if alignment_result.aligned_segments == 0:
            raise NoAlignedSegmentsError(
                f"No segments could be aligned for session {session_id}"
            )

        report_progress(
            30,
            f"Aligned {alignment_result.aligned_segments}/{alignment_result.total_segments} segments",
        )

        # Step 3: Slice audio and generate samples
        sliced_samples: list[SlicedSample] = []
        oto_entries: list[OtoEntry] = []
        confidence_sum = 0.0
        processed_count = 0

        total_alignments = len(alignment_result.segments)
        for idx, segment_alignment in enumerate(alignment_result.segments):
            if not segment_alignment.success:
                skipped += 1
                warnings.append(
                    f"Skipped segment {segment_alignment.audio_filename}: "
                    f"{segment_alignment.error_message}"
                )
                continue

            progress_pct = 30 + (idx / total_alignments) * 50
            report_progress(
                progress_pct, f"Processing segment {segment_alignment.audio_filename}"
            )

            try:
                # Get audio path
                audio_path = await self._session_service.get_segment_audio_path(
                    session_id, segment_alignment.audio_filename
                )

                # Slice and process based on recording style
                samples, entries, conf = await self._process_aligned_segment(
                    audio_path=audio_path,
                    segment_alignment=segment_alignment,
                    recording_style=session.recording_style,
                    output_path=output_path,
                )

                sliced_samples.extend(samples)
                oto_entries.extend(entries)
                confidence_sum += conf * len(entries)
                processed_count += len(entries)

            except Exception as e:
                skipped += 1
                warnings.append(
                    f"Failed to process {segment_alignment.audio_filename}: {e}"
                )
                logger.warning(
                    f"Failed to process segment {segment_alignment.audio_filename}: {e}"
                )

        if not oto_entries:
            raise VoicebankGeneratorError(
                "No samples could be generated from the session"
            )

        report_progress(80, f"Generated {len(oto_entries)} oto entries")

        # Step 4: Write oto.ini
        oto_path = output_path / "oto.ini"
        write_oto_file(oto_path, oto_entries, encoding=encoding)
        report_progress(90, "Wrote oto.ini")

        # Step 5: Write character.txt if requested
        if include_character_txt:
            self._write_character_txt(
                output_path=output_path,
                name=voicebank_name,
                language=session.language,
                recording_style=session.recording_style,
            )

        generation_time = time.time() - start_time
        avg_confidence = confidence_sum / processed_count if processed_count > 0 else 0

        report_progress(100, "Voicebank generation complete")

        return GeneratedVoicebank(
            name=voicebank_name,
            path=output_path.resolve(),
            sample_count=len(sliced_samples),
            oto_entries=len(oto_entries),
            recording_style=session.recording_style,
            language=session.language,
            generation_time_seconds=round(generation_time, 2),
            warnings=warnings,
            skipped_segments=skipped,
            average_confidence=round(avg_confidence, 3),
        )

    async def _process_aligned_segment(
        self,
        audio_path: Path,
        segment_alignment: SegmentAlignment,
        recording_style: str,
        output_path: Path,
    ) -> tuple[list[SlicedSample], list[OtoEntry], float]:
        """Process a single aligned segment into sliced samples.

        Args:
            audio_path: Path to the segment audio file
            segment_alignment: Alignment data with phoneme timestamps
            recording_style: Recording style (cv, vcv, etc.)
            output_path: Output directory for sliced samples

        Returns:
            Tuple of (sliced_samples, oto_entries, average_confidence)
        """
        # Read source audio
        sample_rate, audio_data = wavfile.read(audio_path)
        audio_data = self._normalize_audio(audio_data, sample_rate)

        samples: list[SlicedSample] = []
        entries: list[OtoEntry] = []
        confidence_sum = 0.0

        if recording_style == "cv":
            # CV style: each prompt is typically one CV mora
            result = await self._slice_cv_style(
                audio_data=audio_data,
                sample_rate=sample_rate,
                phonemes=segment_alignment.phonemes,
                prompt_text=segment_alignment.prompt_text,
                segment_id=str(segment_alignment.segment_id),
                output_path=output_path,
            )
            samples.extend(result[0])
            entries.extend(result[1])
            confidence_sum += result[2]

        elif recording_style == "vcv":
            # VCV style: slice at vowel boundaries for transitions
            result = await self._slice_vcv_style(
                audio_data=audio_data,
                sample_rate=sample_rate,
                phonemes=segment_alignment.phonemes,
                prompt_text=segment_alignment.prompt_text,
                segment_id=str(segment_alignment.segment_id),
                output_path=output_path,
            )
            samples.extend(result[0])
            entries.extend(result[1])
            confidence_sum += result[2]

        else:
            # Default: treat whole segment as one sample
            result = await self._slice_whole_segment(
                audio_data=audio_data,
                sample_rate=sample_rate,
                phonemes=segment_alignment.phonemes,
                prompt_text=segment_alignment.prompt_text,
                segment_id=str(segment_alignment.segment_id),
                output_path=output_path,
            )
            samples.extend(result[0])
            entries.extend(result[1])
            confidence_sum += result[2]

        avg_confidence = confidence_sum / len(entries) if entries else 0
        return samples, entries, avg_confidence

    async def _slice_cv_style(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
        phonemes: list[PhonemeSegment],
        prompt_text: str,
        segment_id: str,
        output_path: Path,
    ) -> tuple[list[SlicedSample], list[OtoEntry], float]:
        """Slice audio for CV (consonant-vowel) style samples.

        For CV, each segment typically represents one mora (e.g., 'ka', 'sa').
        We generate one sample per segment with the alias format '- {mora}'.

        Args:
            audio_data: Normalized audio array
            sample_rate: Audio sample rate
            phonemes: Detected phoneme segments
            prompt_text: Original prompt text (e.g., 'ka')
            segment_id: Source segment UUID
            output_path: Output directory

        Returns:
            Tuple of (samples, oto_entries, total_confidence)
        """
        samples: list[SlicedSample] = []
        entries: list[OtoEntry] = []
        total_confidence = 0.0

        # Generate filename from prompt
        safe_prompt = self._sanitize_name(prompt_text)
        filename = f"_{safe_prompt}.wav"
        alias = f"- {prompt_text}"

        # Use full audio with padding trimmed
        if phonemes:
            start_ms = max(0, phonemes[0].start_ms - 10)
            end_ms = phonemes[-1].end_ms + 20
        else:
            # No phonemes detected, use full audio
            duration_ms = len(audio_data) / sample_rate * 1000
            start_ms = 0
            end_ms = duration_ms

        # Slice audio
        sliced_audio = self._slice_audio(audio_data, sample_rate, start_ms, end_ms)

        if sliced_audio is None or len(sliced_audio) < int(
            MIN_SAMPLE_DURATION_MS * sample_rate / 1000
        ):
            logger.warning(f"Sample too short for {prompt_text}, skipping")
            return [], [], 0.0

        # Apply fade in/out
        sliced_audio = self._apply_fade(sliced_audio, sample_rate)

        # Ensure unique filename
        final_filename = self._get_unique_filename(output_path, filename)
        output_file = output_path / final_filename

        # Write audio file
        wavfile.write(output_file, TARGET_SAMPLE_RATE, sliced_audio)

        # Generate oto suggestion
        suggestion = await self._oto_suggester.suggest_oto(output_file, alias=alias)
        total_confidence = suggestion.confidence

        # Create oto entry
        entry = OtoEntry(
            filename=final_filename,
            alias=alias,
            offset=suggestion.offset,
            consonant=suggestion.consonant,
            cutoff=suggestion.cutoff,
            preutterance=suggestion.preutterance,
            overlap=suggestion.overlap,
        )
        entries.append(entry)

        # Create sliced sample record
        sample = SlicedSample(
            filename=final_filename,
            alias=alias,
            source_segment_id=segment_id,
            phoneme=prompt_text,
            start_ms=start_ms,
            end_ms=end_ms,
            duration_ms=end_ms - start_ms,
        )
        samples.append(sample)

        return samples, entries, total_confidence

    async def _slice_vcv_style(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
        phonemes: list[PhonemeSegment],
        prompt_text: str,
        segment_id: str,
        output_path: Path,
    ) -> tuple[list[SlicedSample], list[OtoEntry], float]:
        """Slice audio for VCV (vowel-consonant-vowel) style samples.

        For VCV, segments contain vowel transitions (e.g., 'a ka sa').
        We slice at each vowel to capture 'a ka', 'a sa', etc.

        Args:
            audio_data: Normalized audio array
            sample_rate: Audio sample rate
            phonemes: Detected phoneme segments
            prompt_text: Original prompt text
            segment_id: Source segment UUID
            output_path: Output directory

        Returns:
            Tuple of (samples, oto_entries, total_confidence)
        """
        samples: list[SlicedSample] = []
        entries: list[OtoEntry] = []
        total_confidence = 0.0

        if not phonemes:
            # Fall back to whole segment
            return await self._slice_whole_segment(
                audio_data, sample_rate, phonemes, prompt_text, segment_id, output_path
            )

        # Identify vowel positions
        vowels = "aeiouAEIOU"
        vowel_indices = []
        for i, ph in enumerate(phonemes):
            if any(v in ph.phoneme for v in vowels):
                vowel_indices.append(i)

        if len(vowel_indices) < 2:
            # Not enough vowels for VCV, treat as single sample
            return await self._slice_whole_segment(
                audio_data, sample_rate, phonemes, prompt_text, segment_id, output_path
            )

        # Create VCV samples between vowels
        for i in range(len(vowel_indices) - 1):
            start_idx = vowel_indices[i]
            end_idx = vowel_indices[i + 1]

            # Build alias from phonemes (prev_vowel + consonant(s) + next_vowel)
            prev_vowel = phonemes[start_idx].phoneme
            next_vowel = phonemes[end_idx].phoneme
            middle_phones = [ph.phoneme for ph in phonemes[start_idx + 1 : end_idx]]
            middle_str = "".join(middle_phones) if middle_phones else ""

            alias = f"{prev_vowel} {middle_str}{next_vowel}".strip()
            safe_alias = self._sanitize_name(alias)
            filename = f"_{safe_alias}.wav"

            # Calculate slice boundaries
            start_ms = max(0, phonemes[start_idx].start_ms - 30)
            end_ms = phonemes[end_idx].end_ms + 20

            # Slice audio
            sliced_audio = self._slice_audio(audio_data, sample_rate, start_ms, end_ms)

            if sliced_audio is None or len(sliced_audio) < int(
                MIN_SAMPLE_DURATION_MS * sample_rate / 1000
            ):
                continue

            # Apply fade
            sliced_audio = self._apply_fade(sliced_audio, sample_rate)

            # Unique filename
            final_filename = self._get_unique_filename(output_path, filename)
            output_file = output_path / final_filename

            # Write audio
            wavfile.write(output_file, TARGET_SAMPLE_RATE, sliced_audio)

            # Generate oto suggestion
            suggestion = await self._oto_suggester.suggest_oto(output_file, alias=alias)
            total_confidence += suggestion.confidence

            # Create entry
            entry = OtoEntry(
                filename=final_filename,
                alias=alias,
                offset=suggestion.offset,
                consonant=suggestion.consonant,
                cutoff=suggestion.cutoff,
                preutterance=suggestion.preutterance,
                overlap=suggestion.overlap,
            )
            entries.append(entry)

            # Create sample record
            sample = SlicedSample(
                filename=final_filename,
                alias=alias,
                source_segment_id=segment_id,
                phoneme=alias,
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=end_ms - start_ms,
            )
            samples.append(sample)

        return samples, entries, total_confidence

    async def _slice_whole_segment(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
        phonemes: list[PhonemeSegment],  # noqa: ARG002
        prompt_text: str,
        segment_id: str,
        output_path: Path,
    ) -> tuple[list[SlicedSample], list[OtoEntry], float]:
        """Use the whole segment as a single sample.

        Fallback for recording styles that don't need slicing.

        Args:
            audio_data: Normalized audio array
            sample_rate: Audio sample rate
            phonemes: Detected phoneme segments
            prompt_text: Original prompt text
            segment_id: Source segment UUID
            output_path: Output directory

        Returns:
            Tuple of (samples, oto_entries, total_confidence)
        """
        safe_prompt = self._sanitize_name(prompt_text)
        filename = f"_{safe_prompt}.wav"
        alias = prompt_text

        # Apply fade to whole audio
        audio_with_fade = self._apply_fade(audio_data, sample_rate)

        # Unique filename
        final_filename = self._get_unique_filename(output_path, filename)
        output_file = output_path / final_filename

        # Write audio
        wavfile.write(output_file, TARGET_SAMPLE_RATE, audio_with_fade)

        # Generate oto
        suggestion = await self._oto_suggester.suggest_oto(output_file, alias=alias)

        entry = OtoEntry(
            filename=final_filename,
            alias=alias,
            offset=suggestion.offset,
            consonant=suggestion.consonant,
            cutoff=suggestion.cutoff,
            preutterance=suggestion.preutterance,
            overlap=suggestion.overlap,
        )

        duration_ms = len(audio_data) / sample_rate * 1000
        sample = SlicedSample(
            filename=final_filename,
            alias=alias,
            source_segment_id=segment_id,
            phoneme=prompt_text,
            start_ms=0,
            end_ms=duration_ms,
            duration_ms=duration_ms,
        )

        return [sample], [entry], suggestion.confidence

    def _normalize_audio(self, audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
        """Normalize audio to mono 44.1kHz float32.

        Args:
            audio_data: Input audio array
            sample_rate: Original sample rate

        Returns:
            Normalized audio as float32 mono at TARGET_SAMPLE_RATE
        """
        # Convert to float32
        if audio_data.dtype == np.int16:
            audio_float = audio_data.astype(np.float32) / 32768.0
        elif audio_data.dtype == np.int32:
            audio_float = audio_data.astype(np.float32) / 2147483648.0
        elif audio_data.dtype == np.float32:
            audio_float = audio_data
        elif audio_data.dtype == np.float64:
            audio_float = audio_data.astype(np.float32)
        else:
            audio_float = audio_data.astype(np.float32)

        # Convert to mono if stereo
        if len(audio_float.shape) > 1:
            audio_float = np.mean(audio_float, axis=1)

        # Resample if necessary
        if sample_rate != TARGET_SAMPLE_RATE:
            audio_float = self._resample(audio_float, sample_rate, TARGET_SAMPLE_RATE)

        # Normalize amplitude
        max_amp = np.max(np.abs(audio_float))
        if max_amp > 0:
            audio_float = audio_float / max_amp * 0.95

        return audio_float

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Simple linear resampling.

        Args:
            audio: Input audio array
            orig_sr: Original sample rate
            target_sr: Target sample rate

        Returns:
            Resampled audio array
        """
        if orig_sr == target_sr:
            return audio

        ratio = target_sr / orig_sr
        new_length = int(len(audio) * ratio)
        indices = np.linspace(0, len(audio) - 1, new_length)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

    def _slice_audio(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
        start_ms: float,
        end_ms: float,
    ) -> np.ndarray | None:
        """Extract a slice from audio data.

        Args:
            audio_data: Source audio array
            sample_rate: Sample rate
            start_ms: Start time in milliseconds
            end_ms: End time in milliseconds

        Returns:
            Sliced audio array or None if invalid bounds
        """
        start_sample = int(start_ms * sample_rate / 1000)
        end_sample = int(end_ms * sample_rate / 1000)

        start_sample = max(0, start_sample)
        end_sample = min(len(audio_data), end_sample)

        if end_sample <= start_sample:
            return None

        return audio_data[start_sample:end_sample].copy()

    def _apply_fade(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Apply fade in/out to avoid clicks at boundaries.

        Args:
            audio: Audio array
            sample_rate: Sample rate

        Returns:
            Audio with fades applied
        """
        fade_samples = int(FADE_DURATION_MS * sample_rate / 1000)
        fade_samples = min(fade_samples, len(audio) // 4)

        if fade_samples < 2:
            return audio

        audio = audio.copy()

        # Fade in
        fade_in = np.linspace(0, 1, fade_samples, dtype=np.float32)
        audio[:fade_samples] *= fade_in

        # Fade out
        fade_out = np.linspace(1, 0, fade_samples, dtype=np.float32)
        audio[-fade_samples:] *= fade_out

        return audio

    def _sanitize_name(self, name: str) -> str:
        """Sanitize a name for use in filenames.

        Args:
            name: Original name

        Returns:
            Sanitized name safe for filesystem
        """
        # Replace unsafe characters
        safe = name.replace(" ", "_").replace("/", "_").replace("\\", "_")
        safe = safe.replace(":", "_").replace("*", "_").replace("?", "_")
        safe = safe.replace('"', "_").replace("<", "_").replace(">", "_")
        safe = safe.replace("|", "_")

        # Remove leading/trailing underscores
        safe = safe.strip("_")

        # Ensure non-empty
        if not safe:
            safe = "sample"

        return safe[:50]  # Limit length

    def _get_unique_filename(self, output_path: Path, filename: str) -> str:
        """Get a unique filename, adding suffix if file exists.

        Args:
            output_path: Output directory
            filename: Desired filename

        Returns:
            Unique filename (possibly with numeric suffix)
        """
        if not (output_path / filename).exists():
            return filename

        stem = Path(filename).stem
        suffix = Path(filename).suffix

        counter = 1
        while True:
            new_name = f"{stem}_{counter}{suffix}"
            if not (output_path / new_name).exists():
                return new_name
            counter += 1

    def _write_character_txt(
        self,
        output_path: Path,
        name: str,
        language: str,
        recording_style: str,
    ) -> None:
        """Write character.txt metadata file.

        Args:
            output_path: Voicebank output directory
            name: Voicebank name
            language: Language code
            recording_style: Recording style
        """
        char_path = output_path / "character.txt"
        content = f"""name={name}
type=UTAU voicebank
language={language}
recording_style={recording_style}
generated_by=UTAU Voicebank Manager
"""
        char_path.write_text(content, encoding="utf-8")


# Module-level singleton
_voicebank_generator: VoicebankGenerator | None = None


def get_voicebank_generator(
    session_service: RecordingSessionService | None = None,
    alignment_service: AlignmentService | None = None,
    oto_suggester: OtoSuggester | None = None,
    output_base_path: Path | None = None,
) -> VoicebankGenerator:
    """Get the voicebank generator singleton.

    Args:
        session_service: Recording session service (required on first call)
        alignment_service: Alignment service (required on first call)
        oto_suggester: Oto suggester (required on first call)
        output_base_path: Base path for output (required on first call)

    Returns:
        VoicebankGenerator instance

    Raises:
        ValueError: If required services not provided on first call
    """
    global _voicebank_generator

    if _voicebank_generator is None:
        if session_service is None:
            raise ValueError(
                "session_service required on first call to get_voicebank_generator"
            )
        if alignment_service is None:
            raise ValueError(
                "alignment_service required on first call to get_voicebank_generator"
            )
        if oto_suggester is None:
            raise ValueError(
                "oto_suggester required on first call to get_voicebank_generator"
            )
        if output_base_path is None:
            output_base_path = Path("data/generated")

        _voicebank_generator = VoicebankGenerator(
            session_service=session_service,
            alignment_service=alignment_service,
            oto_suggester=oto_suggester,
            output_base_path=output_base_path,
        )

    return _voicebank_generator
