"""Forced alignment for phoneme-level timestamps.

Uses Montreal Forced Aligner (MFA) for high-precision alignment when available,
with fallback to Wav2Vec2-based alignment for simpler deployments.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING

import librosa
import numpy as np
import soundfile as sf

from src.backend.domain.phoneme import PhonemeSegment

if TYPE_CHECKING:
    from src.backend.ml.sofa_aligner import SOFAForcedAligner

logger = logging.getLogger(__name__)

# Target sample rate for MFA (16kHz mono)
MFA_SAMPLE_RATE = 16000

# Cache directory for MFA models
MODELS_DIR = Path(__file__).parent.parent.parent.parent / "models" / "mfa"


class AlignmentError(Exception):
    """Raised when alignment fails."""

    pass


class AlignmentResult:
    """Result of forced alignment on audio + transcript."""

    def __init__(
        self,
        segments: list[PhonemeSegment],
        audio_duration_ms: float,
        method: str,
        word_segments: list[dict] | None = None,
    ) -> None:
        """Initialize alignment result.

        Args:
            segments: Phoneme-level segments with timestamps
            audio_duration_ms: Total audio duration
            method: Alignment method used (mfa, wav2vec2, etc.)
            word_segments: Optional word-level alignment
        """
        self.segments = segments
        self.audio_duration_ms = audio_duration_ms
        self.method = method
        self.word_segments = word_segments or []

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "segments": [s.model_dump() for s in self.segments],
            "audio_duration_ms": self.audio_duration_ms,
            "method": self.method,
            "word_segments": self.word_segments,
        }


class ForcedAligner(ABC):
    """Abstract interface for forced alignment."""

    @abstractmethod
    async def align(
        self,
        audio_path: Path,
        transcript: str,
        language: str = "ja",
    ) -> AlignmentResult:
        """Align transcript to audio.

        Args:
            audio_path: Path to audio file (WAV)
            transcript: Text transcript of the audio
            language: Language code (ja, en, etc.)

        Returns:
            AlignmentResult with phoneme timestamps

        Raises:
            AlignmentError: If alignment fails
        """
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this aligner is available for use."""
        ...


class MFAForcedAligner(ForcedAligner):
    """Montreal Forced Aligner wrapper.

    Requires MFA to be installed via conda:
        conda install -c conda-forge montreal-forced-aligner

    And acoustic/dictionary models downloaded:
        mfa model download acoustic japanese_mfa
        mfa model download dictionary japanese_mfa
    """

    # MFA model mappings for supported languages
    ACOUSTIC_MODELS = {
        "ja": "japanese_mfa",
        "en": "english_us_arpa",
        "zh": "mandarin_mfa",
        "ko": "korean_mfa",
    }

    DICTIONARY_MODELS = {
        "ja": "japanese_mfa",
        "en": "english_us_arpa",
        "zh": "mandarin_mfa",
        "ko": "korean_mfa",
    }

    def __init__(self) -> None:
        """Initialize MFA aligner."""
        self._mfa_path = shutil.which("mfa")
        self._temp_dirs: list[Path] = []

    def is_available(self) -> bool:
        """Check if MFA is installed and accessible."""
        return self._mfa_path is not None

    def _get_models(self, language: str) -> tuple[str, str]:
        """Get acoustic and dictionary model names for a language.

        Args:
            language: Language code

        Returns:
            Tuple of (acoustic_model, dictionary_model)

        Raises:
            AlignmentError: If language not supported
        """
        if language not in self.ACOUSTIC_MODELS:
            raise AlignmentError(
                f"Unsupported language: {language}. "
                f"Supported: {', '.join(self.ACOUSTIC_MODELS.keys())}"
            )
        return self.ACOUSTIC_MODELS[language], self.DICTIONARY_MODELS[language]

    async def align(
        self,
        audio_path: Path,
        transcript: str,
        language: str = "ja",
    ) -> AlignmentResult:
        """Align transcript to audio using MFA.

        Args:
            audio_path: Path to audio file
            transcript: Text transcript
            language: Language code

        Returns:
            AlignmentResult with phoneme timestamps

        Raises:
            AlignmentError: If alignment fails
        """
        if not self.is_available():
            raise AlignmentError("MFA is not installed or not in PATH")

        acoustic_model, dictionary = self._get_models(language)

        # Create temporary directory for MFA input/output
        temp_dir = Path(tempfile.mkdtemp(prefix="mfa_"))
        self._temp_dirs.append(temp_dir)

        try:
            # Prepare audio (MFA requires 16kHz mono WAV)
            input_dir = temp_dir / "input"
            output_dir = temp_dir / "output"
            input_dir.mkdir()
            output_dir.mkdir()

            # Resample and save audio
            prepared_audio = input_dir / "audio.wav"
            await self._prepare_audio(audio_path, prepared_audio)

            # Create transcript file (MFA expects .lab or .txt files)
            transcript_file = input_dir / "audio.lab"
            transcript_file.write_text(transcript, encoding="utf-8")

            # Run MFA alignment
            assert self._mfa_path is not None  # Checked in is_available()
            cmd = [
                self._mfa_path,
                "align",
                str(input_dir),
                dictionary,
                acoustic_model,
                str(output_dir),
                "--clean",
                "--single_speaker",
                "--output_format",
                "json",
            ]

            logger.info(f"Running MFA: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"MFA failed: {error_msg}")
                raise AlignmentError(f"MFA alignment failed: {error_msg}")

            # Parse MFA output (JSON format)
            result = await self._parse_mfa_output(output_dir, audio_path)
            return result

        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(temp_dir)
                self._temp_dirs.remove(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp dir {temp_dir}: {e}")

    async def _prepare_audio(self, input_path: Path, output_path: Path) -> None:
        """Prepare audio for MFA (16kHz mono WAV).

        Args:
            input_path: Source audio file
            output_path: Output path for prepared audio
        """
        # Load and resample
        audio, sr = librosa.load(str(input_path), sr=MFA_SAMPLE_RATE, mono=True)

        # Normalize
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        # Save as WAV
        sf.write(str(output_path), audio, MFA_SAMPLE_RATE)

    async def _parse_mfa_output(
        self, output_dir: Path, audio_path: Path
    ) -> AlignmentResult:
        """Parse MFA JSON output to AlignmentResult.

        Args:
            output_dir: MFA output directory
            audio_path: Original audio path for duration

        Returns:
            AlignmentResult with parsed segments
        """
        # Find JSON output file
        json_files = list(output_dir.glob("**/*.json"))
        if not json_files:
            # Try TextGrid format as fallback
            textgrid_files = list(output_dir.glob("**/*.TextGrid"))
            if textgrid_files:
                return await self._parse_textgrid(textgrid_files[0], audio_path)
            raise AlignmentError("No MFA output files found")

        # Parse JSON output
        with open(json_files[0]) as f:
            data = json.load(f)

        # Get audio duration
        audio_duration_ms = await self._get_audio_duration(audio_path)

        segments: list[PhonemeSegment] = []
        word_segments: list[dict] = []

        # MFA JSON format has tiers with words and phones
        if "tiers" in data:
            for tier in data["tiers"]:
                tier_name = tier.get("name", "").lower()
                entries = tier.get("entries", [])

                if "phone" in tier_name:
                    for entry in entries:
                        start_s = entry.get("begin", entry.get("start", 0))
                        end_s = entry.get("end", 0)
                        label = entry.get("label", entry.get("text", ""))

                        if label and label not in ("", "sil", "sp", "spn"):
                            segments.append(
                                PhonemeSegment(
                                    phoneme=label,
                                    start_ms=start_s * 1000,
                                    end_ms=end_s * 1000,
                                    confidence=1.0,  # MFA doesn't provide confidence
                                )
                            )

                elif "word" in tier_name:
                    for entry in entries:
                        start_s = entry.get("begin", entry.get("start", 0))
                        end_s = entry.get("end", 0)
                        label = entry.get("label", entry.get("text", ""))

                        if label and label not in ("", "sil", "sp", "spn"):
                            word_segments.append(
                                {
                                    "word": label,
                                    "start_ms": start_s * 1000,
                                    "end_ms": end_s * 1000,
                                }
                            )

        return AlignmentResult(
            segments=segments,
            audio_duration_ms=audio_duration_ms,
            method="mfa",
            word_segments=word_segments,
        )

    async def _parse_textgrid(
        self, textgrid_path: Path, audio_path: Path
    ) -> AlignmentResult:
        """Parse TextGrid format (fallback when JSON not available).

        Args:
            textgrid_path: Path to TextGrid file
            audio_path: Original audio for duration

        Returns:
            AlignmentResult with parsed segments
        """
        audio_duration_ms = await self._get_audio_duration(audio_path)
        segments: list[PhonemeSegment] = []
        word_segments: list[dict] = []

        content = textgrid_path.read_text(encoding="utf-8")
        lines = content.split("\n")

        current_tier = ""
        i = 0
        while i < len(lines):
            line = lines[i].strip()

            if 'name = "' in line:
                current_tier = line.split('"')[1].lower()
            elif "xmin = " in line and i + 2 < len(lines):
                try:
                    xmin = float(line.split("=")[1].strip())
                    xmax = float(lines[i + 1].split("=")[1].strip())
                    text_line = lines[i + 2].strip()
                    if 'text = "' in text_line:
                        text = text_line.split('"')[1]

                        if text and text not in ("", "sil", "sp", "spn"):
                            if "phone" in current_tier:
                                segments.append(
                                    PhonemeSegment(
                                        phoneme=text,
                                        start_ms=xmin * 1000,
                                        end_ms=xmax * 1000,
                                        confidence=1.0,
                                    )
                                )
                            elif "word" in current_tier:
                                word_segments.append(
                                    {
                                        "word": text,
                                        "start_ms": xmin * 1000,
                                        "end_ms": xmax * 1000,
                                    }
                                )
                        i += 2
                except (ValueError, IndexError):
                    pass
            i += 1

        return AlignmentResult(
            segments=segments,
            audio_duration_ms=audio_duration_ms,
            method="mfa",
            word_segments=word_segments,
        )

    async def _get_audio_duration(self, audio_path: Path) -> float:
        """Get audio duration in milliseconds.

        Args:
            audio_path: Path to audio file

        Returns:
            Duration in milliseconds
        """
        duration = librosa.get_duration(path=str(audio_path))
        return duration * 1000


class Wav2Vec2ForcedAligner(ForcedAligner):
    """Wav2Vec2-based forced alignment using CTC constrained decoding.

    When a transcript is provided, converts it to the expected IPA phoneme
    sequence via espeak G2P, then uses torchaudio.functional.forced_align
    to perform transcript-constrained CTC alignment. This produces monotonic
    phoneme boundaries that respect the expected phoneme order, which is
    critical for VCV/CVVC samples where phoneme sequence matters.

    Falls back to blind CTC argmax detection when no transcript is provided.
    """

    # Mapping from UTAU language codes to espeak language codes
    _LANG_MAP = {
        "ja": "ja",
        "en": "en-us",
        "zh": "cmn",
        "ko": "ko",
    }

    def __init__(self) -> None:
        """Initialize Wav2Vec2 aligner."""
        self._model = None
        self._processor = None

    def _ensure_model_loaded(self):
        """Lazily load and cache the Wav2Vec2 model and processor."""
        if self._model is None or self._processor is None:
            from src.backend.ml.phoneme_detector import get_wav2vec2_model

            self._model, self._processor = get_wav2vec2_model()
        return self._model, self._processor

    def is_available(self) -> bool:
        """Wav2Vec2 is always available if transformers and torchaudio are installed."""
        try:
            import torchaudio.functional  # noqa: F401
            import transformers  # noqa: F401

            return True
        except ImportError:
            return False

    def _transcript_to_ipa_tokens(
        self,
        transcript: str,
        language: str,
        vocab: dict[str, int],
    ) -> list[int] | None:
        """Convert a transcript to IPA token IDs using espeak G2P.

        Uses the phonemizer library (espeak backend) to convert the transcript
        into IPA phonemes, then maps each phoneme to the Wav2Vec2 vocabulary.

        Args:
            transcript: Text transcript (romaji, kana, or natural language)
            language: Language code (ja, en, etc.)
            vocab: Wav2Vec2 tokenizer vocabulary mapping tokens to IDs

        Returns:
            List of token IDs for forced alignment, or None if G2P fails
        """
        try:
            from phonemizer import phonemize
            from phonemizer.separator import Separator
        except ImportError:
            logger.warning(
                "phonemizer not installed, cannot do G2P for forced alignment"
            )
            return None

        espeak_lang = self._LANG_MAP.get(language, language)

        # For Japanese, convert romaji to kana first for better espeak results.
        # Espeak handles kana input well but interprets romaji as English.
        if espeak_lang == "ja":
            from src.backend.utils.kana_romaji import contains_kana, romaji_to_hiragana

            if not contains_kana(transcript):
                # Convert romaji words to hiragana for espeak
                # Handle space-separated syllables (e.g. "a ka" -> "あか")
                parts = transcript.strip().split()
                kana_parts = [romaji_to_hiragana(p) for p in parts]
                transcript = "".join(kana_parts)

        try:
            # Use pipe separator for phones since space is used for words
            sep = Separator(phone="|", word=" ", syllable="")
            ipa_str = phonemize(
                transcript,
                language=espeak_lang,
                backend="espeak",
                separator=sep,
                strip=True,
            )
        except Exception as e:
            logger.warning(f"espeak G2P failed for '{transcript}' ({espeak_lang}): {e}")
            return None

        if not ipa_str:
            logger.warning(f"espeak G2P returned empty result for '{transcript}'")
            return None

        # Parse IPA output into individual phoneme tokens
        # phonemizer output format: "p|h|o|n" with | between phones, space between words
        ipa_phones = []
        for word_chunk in ipa_str.split():
            for phone in word_chunk.split("|"):
                phone = phone.strip()
                if phone:
                    ipa_phones.append(phone)

        if not ipa_phones:
            logger.warning(f"No IPA phones extracted from '{ipa_str}'")
            return None

        # Map IPA phones to vocabulary token IDs
        token_ids = []
        unmapped = []
        for phone in ipa_phones:
            if phone in vocab:
                token_ids.append(vocab[phone])
            else:
                unmapped.append(phone)

        if unmapped:
            logger.warning(
                f"IPA phones not in Wav2Vec2 vocab (skipped): {unmapped} "
                f"from transcript '{transcript}'"
            )

        if not token_ids:
            logger.warning(
                f"No valid token IDs from G2P for '{transcript}' "
                f"(IPA: {ipa_phones})"
            )
            return None

        logger.debug(
            f"G2P: '{transcript}' -> IPA {ipa_phones} -> " f"token_ids {token_ids}"
        )
        return token_ids

    async def align(
        self,
        audio_path: Path,
        transcript: str,
        language: str = "ja",
    ) -> AlignmentResult:
        """Align transcript to audio using Wav2Vec2 CTC forced alignment.

        When a transcript is provided, performs true forced alignment:
        1. Converts transcript to IPA phoneme sequence via espeak G2P
        2. Runs Wav2Vec2 to get CTC log-probabilities
        3. Uses torchaudio.functional.forced_align for constrained decoding
        4. Returns monotonic phoneme boundaries matching the transcript

        Falls back to blind CTC argmax detection if:
        - transcript is empty
        - G2P conversion fails
        - forced alignment fails (e.g. audio too short for transcript)

        Args:
            audio_path: Path to audio file
            transcript: Text transcript for constrained alignment
            language: Language code (ja, en, zh, ko)

        Returns:
            AlignmentResult with phoneme timestamps
        """
        import torch

        from src.backend.ml.phoneme_detector import preprocess_audio

        model, processor = self._ensure_model_loaded()
        vocab = processor.tokenizer.get_vocab()
        id_to_token = {v: k for k, v in vocab.items()}
        blank_id = processor.tokenizer.pad_token_id

        # Load and preprocess audio
        audio, sample_rate, duration_ms = preprocess_audio(audio_path)

        # Prepare input for model
        inputs = processor(
            audio,
            sampling_rate=sample_rate,
            return_tensors="pt",
            padding=True,
        )

        device = next(model.parameters()).device
        input_values = inputs.input_values.to(device)

        try:
            with torch.no_grad():
                outputs = model(input_values)
                logits = outputs.logits  # [1, T, C]

            # Try transcript-constrained forced alignment if transcript provided
            if transcript and transcript.strip():
                token_ids = self._transcript_to_ipa_tokens(transcript, language, vocab)
                if token_ids:
                    segments = self._forced_align_with_tokens(
                        logits, token_ids, id_to_token, blank_id, duration_ms
                    )
                    if segments is not None:
                        return AlignmentResult(
                            segments=segments,
                            audio_duration_ms=duration_ms,
                            method="wav2vec2-forced",
                            word_segments=[],
                        )
                    logger.info(
                        "Wav2Vec2 forced alignment failed, falling back to CTC argmax"
                    )

            # Fallback: blind CTC argmax detection
            segments = self._ctc_argmax_decode(
                logits, id_to_token, blank_id, duration_ms
            )

            return AlignmentResult(
                segments=segments,
                audio_duration_ms=duration_ms,
                method="wav2vec2",
                word_segments=[],
            )

        except Exception as e:
            raise AlignmentError(f"Wav2Vec2 alignment failed: {e}") from e

        finally:
            import torch as _torch

            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()

    def _forced_align_with_tokens(
        self,
        logits,
        token_ids: list[int],
        id_to_token: dict[int, str],
        blank_id: int,
        duration_ms: float,
    ) -> list[PhonemeSegment] | None:
        """Perform CTC forced alignment using torchaudio.

        Uses torchaudio.functional.forced_align to find the optimal
        monotonic alignment of the expected token sequence to the CTC
        emission matrix.

        Args:
            logits: Raw CTC logits from Wav2Vec2, shape [1, T, C]
            token_ids: Expected phoneme token IDs from G2P
            id_to_token: Reverse vocabulary mapping
            blank_id: CTC blank token ID
            duration_ms: Total audio duration in milliseconds

        Returns:
            List of PhonemeSegments, or None if alignment fails
        """
        import torch
        import torchaudio.functional as F

        try:
            # Convert logits to log probabilities
            log_probs = torch.log_softmax(logits, dim=-1)  # [1, T, C]

            # Prepare targets tensor
            targets = torch.tensor(
                [token_ids], dtype=torch.int32, device=log_probs.device
            )

            # Run forced alignment
            alignments, scores = F.forced_align(log_probs, targets, blank=blank_id)

            # Merge consecutive identical tokens to get spans
            # scores are log probabilities; exp() converts to probabilities
            token_spans = F.merge_tokens(alignments[0], scores[0].exp())

            # Use fixed frame duration for Wav2Vec2
            ms_per_frame = 20.0  # WAV2VEC2_FRAME_DURATION_MS

            segments: list[PhonemeSegment] = []
            for i, span in enumerate(token_spans):
                token_id = token_ids[i] if i < len(token_ids) else None
                phoneme = (
                    id_to_token.get(token_id, "?") if token_id is not None else "?"
                )

                # Skip special tokens
                if phoneme.startswith("<") or phoneme.startswith("|"):
                    continue

                start_ms = float(span.start) * ms_per_frame
                end_ms = float(span.end) * ms_per_frame

                # Clamp end to audio duration
                end_ms = min(end_ms, duration_ms)

                # For the last segment, extend to fill remaining audio if close
                is_last = i == len(token_spans) - 1
                if is_last and (duration_ms - end_ms) < 100.0:
                    end_ms = duration_ms

                confidence = float(span.score)

                segments.append(
                    PhonemeSegment(
                        phoneme=phoneme,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        confidence=confidence,
                    )
                )

            if not segments:
                logger.warning("Forced alignment produced no segments")
                return None

            return segments

        except Exception as e:
            logger.warning(f"torchaudio forced_align failed: {e}")
            return None

    def _ctc_argmax_decode(
        self,
        logits,
        id_to_token: dict[int, str],
        blank_id: int,
        duration_ms: float,
    ) -> list[PhonemeSegment]:
        """Fallback blind CTC argmax decoding (no transcript constraint).

        This is the original detection approach: takes the argmax of the CTC
        output at each frame and groups consecutive identical tokens into
        segments. Used when no transcript is available or G2P fails.

        Args:
            logits: Raw CTC logits from Wav2Vec2, shape [1, T, C]
            id_to_token: Reverse vocabulary mapping
            blank_id: CTC blank token ID
            duration_ms: Total audio duration in milliseconds

        Returns:
            List of PhonemeSegments from blind detection
        """
        import torch

        ms_per_frame = 20.0  # WAV2VEC2_FRAME_DURATION_MS

        predicted_ids = torch.argmax(logits, dim=-1)
        probs = torch.softmax(logits, dim=-1)
        max_probs = torch.max(probs, dim=-1).values

        predicted_ids_list = predicted_ids[0].cpu().tolist()
        probs_list = max_probs[0].cpu().tolist()

        segments: list[PhonemeSegment] = []
        current_token_id: int | None = None
        current_start_frame = 0
        current_probs: list[float] = []

        for frame_idx, (token_id, prob) in enumerate(
            zip(predicted_ids_list, probs_list, strict=True)
        ):
            if token_id == blank_id:
                if current_token_id is not None and current_token_id != blank_id:
                    phoneme = id_to_token.get(current_token_id, "<unk>")
                    if not phoneme.startswith("<") and not phoneme.startswith("|"):
                        segments.append(
                            PhonemeSegment(
                                phoneme=phoneme,
                                start_ms=current_start_frame * ms_per_frame,
                                end_ms=frame_idx * ms_per_frame,
                                confidence=float(np.mean(current_probs)),
                            )
                        )
                current_token_id = None
                current_probs = []
            elif token_id != current_token_id:
                if current_token_id is not None and current_token_id != blank_id:
                    phoneme = id_to_token.get(current_token_id, "<unk>")
                    if not phoneme.startswith("<") and not phoneme.startswith("|"):
                        segments.append(
                            PhonemeSegment(
                                phoneme=phoneme,
                                start_ms=current_start_frame * ms_per_frame,
                                end_ms=frame_idx * ms_per_frame,
                                confidence=float(np.mean(current_probs)),
                            )
                        )
                current_token_id = token_id
                current_start_frame = frame_idx
                current_probs = [prob]
            else:
                current_probs.append(prob)

        # Handle final segment
        if current_token_id is not None and current_token_id != blank_id:
            phoneme = id_to_token.get(current_token_id, "<unk>")
            if not phoneme.startswith("<") and not phoneme.startswith("|"):
                segments.append(
                    PhonemeSegment(
                        phoneme=phoneme,
                        start_ms=current_start_frame * ms_per_frame,
                        end_ms=duration_ms,
                        confidence=float(np.mean(current_probs)),
                    )
                )

        return segments


class ForcedAlignerFactory:
    """Factory for creating the appropriate forced aligner.

    Priority order (configurable):
    1. SOFA (if prefer_sofa=True and available) - best for singing
    2. MFA (if prefer_mfa=True and available) - best for speech
    3. Wav2Vec2 - always available fallback
    """

    _mfa_aligner: MFAForcedAligner | None = None
    _wav2vec2_aligner: Wav2Vec2ForcedAligner | None = None
    _sofa_aligner: SOFAForcedAligner | None = None

    @classmethod
    def get_aligner(
        cls,
        prefer_mfa: bool = True,
        prefer_sofa: bool = False,
    ) -> ForcedAligner:
        """Get the best available forced aligner.

        Args:
            prefer_mfa: If True, prefer MFA over Wav2Vec2
            prefer_sofa: If True, prefer SOFA over MFA (for singing)

        Returns:
            ForcedAligner instance

        Priority order:
            1. SOFA (if prefer_sofa and available)
            2. MFA (if prefer_mfa and available)
            3. Wav2Vec2 (always available)
        """
        # Try SOFA first if preferred (best for singing)
        if prefer_sofa:
            sofa = cls.get_sofa_aligner()
            if sofa.is_available():
                logger.info("Using SOFA (Singing-Oriented Forced Aligner)")
                return sofa

        # Try MFA if preferred (best for speech)
        if prefer_mfa:
            if cls._mfa_aligner is None:
                cls._mfa_aligner = MFAForcedAligner()

            if cls._mfa_aligner.is_available():
                logger.info("Using Montreal Forced Aligner")
                return cls._mfa_aligner

        # Fallback to Wav2Vec2
        if cls._wav2vec2_aligner is None:
            cls._wav2vec2_aligner = Wav2Vec2ForcedAligner()

        logger.info("Using Wav2Vec2 aligner (MFA/SOFA not available)")
        return cls._wav2vec2_aligner

    @classmethod
    def get_mfa_aligner(cls) -> MFAForcedAligner:
        """Get MFA aligner specifically (may not be available).

        Returns:
            MFAForcedAligner instance
        """
        if cls._mfa_aligner is None:
            cls._mfa_aligner = MFAForcedAligner()
        return cls._mfa_aligner

    @classmethod
    def get_wav2vec2_aligner(cls) -> Wav2Vec2ForcedAligner:
        """Get Wav2Vec2 aligner.

        Returns:
            Wav2Vec2ForcedAligner instance
        """
        if cls._wav2vec2_aligner is None:
            cls._wav2vec2_aligner = Wav2Vec2ForcedAligner()
        return cls._wav2vec2_aligner

    @classmethod
    def get_sofa_aligner(cls) -> SOFAForcedAligner:
        """Get SOFA aligner (may not be available).

        Returns:
            SOFAForcedAligner instance
        """
        if cls._sofa_aligner is None:
            from src.backend.ml.sofa_aligner import SOFAForcedAligner

            cls._sofa_aligner = SOFAForcedAligner()
        return cls._sofa_aligner


# Module-level convenience functions


def get_forced_aligner(
    prefer_mfa: bool = True,
    prefer_sofa: bool = False,
) -> ForcedAligner:
    """Get the best available forced aligner.

    Args:
        prefer_mfa: If True, prefer MFA over Wav2Vec2
        prefer_sofa: If True, prefer SOFA over MFA (for singing)

    Returns:
        ForcedAligner instance
    """
    return ForcedAlignerFactory.get_aligner(prefer_mfa, prefer_sofa)


async def align_audio(
    audio_path: Path,
    transcript: str,
    language: str = "ja",
    prefer_mfa: bool = True,
    prefer_sofa: bool = False,
) -> AlignmentResult:
    """Convenience function to align audio to transcript.

    Args:
        audio_path: Path to audio file
        transcript: Text transcript
        language: Language code
        prefer_mfa: If True, prefer MFA when available
        prefer_sofa: If True, prefer SOFA when available (for singing)

    Returns:
        AlignmentResult with phoneme timestamps
    """
    aligner = get_forced_aligner(prefer_mfa, prefer_sofa)
    return await aligner.align(audio_path, transcript, language)
