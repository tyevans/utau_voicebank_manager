"""SOFA (Singing-Oriented Forced Aligner) integration.

SOFA is a neural forced aligner optimized for singing voice applications.
It produces more accurate alignments for sustained vowels and singing-specific
phonation patterns compared to speech-oriented aligners like MFA.

GitHub: https://github.com/qiuqiao/SOFA

Requires:
    - SOFA repository cloned and configured
    - Pretrained checkpoint files (.ckpt)
    - Language-specific dictionary files

Environment variable:
    SOFA_PATH: Path to SOFA repository root (contains infer.py)
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import librosa
import numpy as np
import soundfile as sf

from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_aligner import AlignmentError, AlignmentResult, ForcedAligner
from src.backend.ml.gpu_fallback import run_inference_with_cpu_fallback
from src.backend.ml.model_registry import get_sofa_cache_ttl

if TYPE_CHECKING:
    import torch

logger = logging.getLogger(__name__)

# Target sample rate for SOFA (matches model training)
SOFA_SAMPLE_RATE = 44100

# Default SOFA paths - use git submodule in vendor/SOFA
SOFA_SUBMODULE_DIR = Path(__file__).parent.parent.parent.parent / "vendor" / "SOFA"
SOFA_CHECKPOINTS_DIR = SOFA_SUBMODULE_DIR / "ckpt"
SOFA_DICTIONARY_DIR = SOFA_SUBMODULE_DIR / "dictionary"

# Model cache TTL in seconds.
# Default is 60 minutes (configurable via SOFA_CACHE_TTL_SECONDS env var).
# The previous 5-minute TTL caused unnecessary model reloads during batch jobs.
MODEL_CACHE_TTL_SECONDS = get_sofa_cache_ttl()


class DictionaryValidationError(AlignmentError):
    """Raised when transcript contains phonemes not in the SOFA dictionary.

    This error indicates the alignment cannot proceed because none of the
    phonemes in the transcript are recognized by the dictionary. The caller
    should fall back to an alternative alignment method (e.g., VAD/energy-based).

    Attributes:
        unrecognized_phonemes: Set of phonemes not found in dictionary
        transcript: The original transcript that failed validation
    """

    def __init__(
        self,
        message: str,
        unrecognized_phonemes: set[str] | None = None,
        transcript: str = "",
    ) -> None:
        super().__init__(message)
        self.unrecognized_phonemes = unrecognized_phonemes or set()
        self.transcript = transcript


def load_dictionary(dict_path: Path) -> set[str]:
    """Load SOFA dictionary and return set of known words.

    Args:
        dict_path: Path to dictionary file (tab-separated word/phoneme mappings)

    Returns:
        Set of words recognized by the dictionary
    """
    words = set()
    try:
        with open(dict_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and "\t" in line:
                    word = line.split("\t")[0].strip()
                    if word:
                        words.add(word)
    except Exception as e:
        logger.warning(f"Failed to load dictionary {dict_path}: {e}")
    return words


def decompose_unknown_word(word: str, dictionary: set[str]) -> list[str] | None:
    """Try to decompose an unknown word into known dictionary entries.

    Uses greedy longest-match from left to right. For example, if the
    dictionary contains "a", "ka", and "shi", the word "akashi" would
    decompose into ["a", "ka", "shi"].

    This handles VCV transcript words that were concatenated or contain
    phoneme sequences not entered as single dictionary entries. For example,
    a transcript word "aka" is not in the dictionary, but "a" + "ka" are.

    Args:
        word: The unknown word to decompose
        dictionary: Set of known dictionary words

    Returns:
        List of known dictionary words that compose the input, or None
        if decomposition is not possible
    """
    if not word:
        return None

    # Sort dictionary entries by length (longest first) for greedy matching
    # Filter to entries that could be substrings of the word
    candidates = sorted(
        (entry for entry in dictionary if len(entry) <= len(word)),
        key=len,
        reverse=True,
    )

    # Dynamic programming approach: find a valid decomposition
    # memo[i] = list of words that decompose word[:i], or None
    n = len(word)
    memo: list[list[str] | None] = [None] * (n + 1)
    memo[0] = []

    for i in range(n):
        if memo[i] is None:
            continue
        for entry in candidates:
            entry_len = len(entry)
            if i + entry_len <= n and word[i : i + entry_len] == entry:
                new_decomp = memo[i] + [entry]
                # Prefer decompositions with fewer parts (longer matches)
                if memo[i + entry_len] is None or len(new_decomp) < len(
                    memo[i + entry_len]
                ):
                    memo[i + entry_len] = new_decomp

    result = memo[n]
    if result and len(result) > 1:
        # Only return if we actually decomposed into multiple parts
        # (single-part means the word itself was found, which shouldn't happen
        # since we only call this for unknown words)
        logger.debug(f"Decomposed unknown word '{word}' into: {result}")
        return result

    return None


def validate_transcript_against_dictionary(
    transcript: str,
    dict_path: Path,
    *,
    require_all: bool = False,
) -> tuple[list[str], list[str]]:
    """Validate transcript phonemes against SOFA dictionary.

    When a word is not directly in the dictionary, attempts to decompose it
    into known dictionary entries (e.g., "aka" -> ["a", "ka"]). This allows
    VCV transcripts containing concatenated phonemes to pass validation.

    Args:
        transcript: Space-separated phoneme/word sequence
        dict_path: Path to the dictionary file
        require_all: If True, raise error if ANY phoneme is unrecognized.
                    If False, only raise if ALL phonemes are unrecognized.

    Returns:
        Tuple of (recognized_words, unrecognized_words).
        recognized_words may contain more entries than the original transcript
        if decomposition expanded unknown words into multiple known entries.

    Raises:
        DictionaryValidationError: If validation fails based on require_all setting
    """
    dictionary = load_dictionary(dict_path)
    words = transcript.strip().split()

    recognized: list[str] = []
    unrecognized: list[str] = []

    for word in words:
        if word in dictionary:
            recognized.append(word)
        else:
            # Try decomposing the unknown word into known dictionary entries
            decomposed = decompose_unknown_word(word, dictionary)
            if decomposed:
                logger.info(
                    f"Decomposed unknown word '{word}' into dictionary entries: "
                    f"{decomposed}"
                )
                recognized.extend(decomposed)
            else:
                unrecognized.append(word)

    # Check validation criteria
    if require_all and unrecognized:
        raise DictionaryValidationError(
            f"Unrecognized phonemes in transcript: {unrecognized}",
            unrecognized_phonemes=set(unrecognized),
            transcript=transcript,
        )

    if not recognized:
        raise DictionaryValidationError(
            f"No recognized phonemes in transcript '{transcript}'. "
            f"All words are unknown: {unrecognized}",
            unrecognized_phonemes=set(unrecognized),
            transcript=transcript,
        )

    return recognized, unrecognized


@dataclass
class CachedSOFAModel:
    """Cached SOFA model with metadata for TTL tracking."""

    model: object  # LitForcedAlignmentTask
    g2p: object  # DictionaryG2P
    device: torch.device
    checkpoint_path: Path
    dictionary_path: Path
    last_accessed: float = field(default_factory=time.time)

    def touch(self) -> None:
        """Update last accessed time."""
        self.last_accessed = time.time()

    def is_expired(self, ttl_seconds: float = MODEL_CACHE_TTL_SECONDS) -> bool:
        """Check if the cache entry has expired."""
        return (time.time() - self.last_accessed) > ttl_seconds


class SOFAModelManager:
    """Thread-safe manager for cached SOFA models with TTL eviction.

    Caches loaded SOFA models per (checkpoint, dictionary) pair to avoid
    repeated model loading on every inference call. Uses a configurable TTL
    (default 60 minutes, set via SOFA_CACHE_TTL_SECONDS env var) to
    automatically clean up unused models and free GPU memory.
    """

    _instance: SOFAModelManager | None = None
    _lock = threading.Lock()

    def __new__(cls) -> SOFAModelManager:
        """Singleton pattern for global model cache."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        """Initialize the model manager."""
        if self._initialized:
            return
        self._cache: dict[str, CachedSOFAModel] = {}
        self._cache_lock = threading.Lock()
        self._sofa_imported = False
        self._initialized = True

    def _get_cache_key(self, checkpoint_path: Path, dictionary_path: Path) -> str:
        """Generate cache key from paths."""
        return f"{checkpoint_path}|{dictionary_path}"

    def _ensure_sofa_in_path(self) -> None:
        """Ensure SOFA modules are importable."""
        if self._sofa_imported:
            return

        sofa_path = str(SOFA_SUBMODULE_DIR)
        if sofa_path not in sys.path:
            sys.path.insert(0, sofa_path)
            logger.debug(f"Added SOFA to sys.path: {sofa_path}")
        self._sofa_imported = True

    def _cleanup_expired(self) -> None:
        """Remove expired models from cache and free GPU memory."""
        import torch

        with self._cache_lock:
            expired_keys = [
                key for key, cached in self._cache.items() if cached.is_expired()
            ]
            for key in expired_keys:
                cached = self._cache.pop(key)
                logger.info(f"Evicting expired SOFA model from cache: {key}")
                # Help garbage collector by deleting references
                del cached.model
                del cached.g2p
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

    def get_or_load(
        self,
        checkpoint_path: Path,
        dictionary_path: Path,
    ) -> CachedSOFAModel:
        """Get a cached model or load a new one.

        Args:
            checkpoint_path: Path to SOFA checkpoint (.ckpt)
            dictionary_path: Path to dictionary file (.txt)

        Returns:
            CachedSOFAModel with ready-to-use model and G2P

        Raises:
            AlignmentError: If model loading fails
        """
        import torch

        self._ensure_sofa_in_path()
        self._cleanup_expired()

        cache_key = self._get_cache_key(checkpoint_path, dictionary_path)

        with self._cache_lock:
            if cache_key in self._cache:
                cached = self._cache[cache_key]
                cached.touch()
                logger.debug(f"Using cached SOFA model: {cache_key}")
                return cached

        # Load outside the lock to avoid blocking other threads
        logger.info(f"Loading SOFA model: {checkpoint_path}")
        try:
            # Import SOFA modules
            from modules.g2p.dictionary_g2p import DictionaryG2P
            from modules.task.forced_alignment import LitForcedAlignmentTask

            # Determine device
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            logger.info(f"Using device: {device}")

            # Load model from checkpoint
            # Note: weights_only=False is required for SOFA checkpoints which
            # contain custom classes that need to be unpickled
            model = LitForcedAlignmentTask.load_from_checkpoint(
                str(checkpoint_path),
                map_location=device,
                weights_only=False,
            )
            model.to(device)
            model.eval()

            # Set inference mode and initialize melspec extractor
            model.set_inference_mode("force")
            model.on_predict_start()

            # Load G2P (grapheme-to-phoneme converter)
            g2p = DictionaryG2P(dictionary=str(dictionary_path))

            cached = CachedSOFAModel(
                model=model,
                g2p=g2p,
                device=device,
                checkpoint_path=checkpoint_path,
                dictionary_path=dictionary_path,
            )

            with self._cache_lock:
                self._cache[cache_key] = cached

            logger.info(f"SOFA model loaded and cached: {cache_key}")
            return cached

        except Exception as e:
            logger.error(f"Failed to load SOFA model: {e}")
            raise AlignmentError(f"Failed to load SOFA model: {e}") from e

    def clear_cache(self) -> None:
        """Clear all cached models."""
        import torch

        with self._cache_lock:
            self._cache.clear()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        logger.info("Cleared SOFA model cache")


# Global model manager instance
_model_manager: SOFAModelManager | None = None


def get_model_manager() -> SOFAModelManager:
    """Get the global SOFA model manager instance."""
    global _model_manager
    if _model_manager is None:
        _model_manager = SOFAModelManager()
    return _model_manager


class SOFAForcedAligner(ForcedAligner):
    """SOFA (Singing-Oriented Forced Aligner) wrapper.

    SOFA is specifically designed for singing voice alignment and produces
    better results for sustained vowels and singing-specific phonation
    compared to speech-oriented aligners.

    This implementation supports two modes:
    1. Native mode (default): Loads model directly in Python with TTL caching
    2. Subprocess mode (fallback): Shells out to infer.py for compatibility

    Installation:
        1. Clone SOFA: git clone https://github.com/qiuqiao/SOFA
        2. Set SOFA_PATH environment variable to the repo directory
        3. Download pretrained checkpoints to models/sofa/checkpoints/
        4. Download dictionaries to models/sofa/dictionary/

    Pretrained models:
        - tgm_en_v100.ckpt: English model
        - chinese/mandarin models available
        - Korean, French models available
    """

    # SOFA checkpoint mappings for supported languages
    CHECKPOINTS = {
        "en": "tgm_en_v100.ckpt",
        "zh": "mandarin.ckpt",  # Common naming convention
        "ko": "korean.ckpt",
        "fr": "french.ckpt",
        "ja": "japanese.ckpt",  # May need custom training
    }

    # Dictionary file mappings
    # For Japanese, we use the extended dictionary which includes:
    # - All basic CV syllables from the original japanese.txt
    # - VCV-compatible entries (space-separated phonemes)
    # - Single consonants for English loanwords (b, d, f, g, etc.)
    # - Extended vowel combinations (ae, ay, ey, ow, etc.)
    DICTIONARIES = {
        "en": "english.txt",
        "zh": "opencpop-extension.txt",
        "ko": "korean.txt",
        "fr": "french.txt",
        "ja": "japanese.txt",
    }

    def __init__(
        self,
        sofa_path: Path | str | None = None,
        checkpoints_dir: Path | str | None = None,
        dictionary_dir: Path | str | None = None,
        use_native: bool = True,
    ) -> None:
        """Initialize SOFA aligner.

        Args:
            sofa_path: Path to SOFA repository (or use SOFA_PATH env var)
            checkpoints_dir: Path to checkpoint files (default: models/sofa/checkpoints/)
            dictionary_dir: Path to dictionary files (default: models/sofa/dictionary/)
            use_native: If True, use native Python loading; if False, use subprocess
        """
        # Get SOFA path from argument, env var, or default search
        self._sofa_path: Path | None
        if sofa_path:
            self._sofa_path = Path(sofa_path)
        elif os.environ.get("SOFA_PATH"):
            self._sofa_path = Path(os.environ["SOFA_PATH"])
        else:
            self._sofa_path = self._find_sofa_installation()

        # Set checkpoint and dictionary directories
        self._checkpoints_dir = (
            Path(checkpoints_dir) if checkpoints_dir else SOFA_CHECKPOINTS_DIR
        )
        self._dictionary_dir = (
            Path(dictionary_dir) if dictionary_dir else SOFA_DICTIONARY_DIR
        )

        self._use_native = use_native
        self._temp_dirs: list[Path] = []

    def _find_sofa_installation(self) -> Path | None:
        """Try to find SOFA installation in common locations.

        Checks the git submodule first (vendor/SOFA), then falls back
        to common installation paths.

        Returns:
            Path to SOFA directory or None if not found
        """
        # Check submodule first (preferred)
        if SOFA_SUBMODULE_DIR.exists() and (SOFA_SUBMODULE_DIR / "infer.py").exists():
            return SOFA_SUBMODULE_DIR

        # Fallback to common paths
        common_paths = [
            Path.home() / "SOFA",
            Path.home() / "sofa",
            Path("/opt/SOFA"),
            Path("/opt/sofa"),
        ]

        for path in common_paths:
            if path.exists() and (path / "infer.py").exists():
                return path

        return None

    def is_available(self) -> bool:
        """Check if SOFA is installed and has required files.

        Returns:
            True if SOFA can be used for alignment
        """
        # Check if SOFA path exists with infer.py
        if not self._sofa_path or not self._sofa_path.exists():
            logger.debug("SOFA path not found")
            return False

        infer_script = self._sofa_path / "infer.py"
        if not infer_script.exists():
            logger.debug(f"infer.py not found in {self._sofa_path}")
            return False

        # Check if at least one checkpoint exists
        if not self._checkpoints_dir.exists():
            logger.debug(f"Checkpoints directory not found: {self._checkpoints_dir}")
            return False

        checkpoints = list(self._checkpoints_dir.glob("*.ckpt"))
        if not checkpoints:
            logger.debug(f"No .ckpt files found in {self._checkpoints_dir}")
            return False

        # Check if at least one dictionary exists
        if not self._dictionary_dir.exists():
            logger.debug(f"Dictionary directory not found: {self._dictionary_dir}")
            return False

        dictionaries = list(self._dictionary_dir.glob("*.txt"))
        if not dictionaries:
            logger.debug(f"No dictionary files found in {self._dictionary_dir}")
            return False

        return True

    def get_available_languages(self) -> list[str]:
        """Get list of languages with available models.

        Returns:
            List of language codes that have both checkpoint and dictionary
        """
        available = []

        for lang, ckpt_name in self.CHECKPOINTS.items():
            ckpt_path = self._checkpoints_dir / ckpt_name
            dict_name = self.DICTIONARIES.get(lang, "")
            dict_path = self._dictionary_dir / dict_name

            if ckpt_path.exists() and dict_path.exists():
                available.append(lang)

        return available

    def _get_model_paths(self, language: str) -> tuple[Path, Path]:
        """Get checkpoint and dictionary paths for a language.

        Args:
            language: Language code (en, zh, ja, ko, fr)

        Returns:
            Tuple of (checkpoint_path, dictionary_path)

        Raises:
            AlignmentError: If language not supported or files missing
        """
        if language not in self.CHECKPOINTS:
            raise AlignmentError(
                f"Unsupported language for SOFA: {language}. "
                f"Supported: {', '.join(self.CHECKPOINTS.keys())}"
            )

        ckpt_name = self.CHECKPOINTS[language]
        dict_name = self.DICTIONARIES[language]

        ckpt_path = self._checkpoints_dir / ckpt_name
        dict_path = self._dictionary_dir / dict_name

        if not ckpt_path.exists():
            raise AlignmentError(
                f"Checkpoint not found for {language}: {ckpt_path}. "
                f"Download from https://github.com/qiuqiao/SOFA"
            )

        if not dict_path.exists():
            raise AlignmentError(
                f"Dictionary not found for {language}: {dict_path}. "
                f"Download from https://github.com/qiuqiao/SOFA"
            )

        return ckpt_path, dict_path

    async def _infer_native(
        self,
        audio_path: Path,
        transcript: str,
        language: str,
    ) -> AlignmentResult:
        """Run inference using native Python model loading.

        This method loads the SOFA model directly in Python (cached with TTL)
        and runs inference without spawning a subprocess.

        Args:
            audio_path: Path to audio file (WAV)
            transcript: Text transcript (space-separated words from dictionary)
            language: Language code

        Returns:
            AlignmentResult with phoneme timestamps
        """
        import torch
        from einops import repeat

        ckpt_path, dict_path = self._get_model_paths(language)

        # Validate transcript against dictionary before loading model.
        # This prevents loading heavy models only to fail on unknown phonemes.
        # The validation now also decomposes unknown words into known entries
        # (e.g., "akasa" -> ["a", "ka", "sa"]).
        try:
            recognized, unrecognized = validate_transcript_against_dictionary(
                transcript, dict_path
            )
            if unrecognized:
                logger.info(
                    f"Transcript '{transcript}' has unrecognized phonemes: {unrecognized}. "
                    f"Proceeding with recognized: {recognized}"
                )
        except DictionaryValidationError:
            # Re-raise to let caller handle fallback
            raise

        # Build a clean transcript from recognized words for G2P.
        # This ensures we only pass dictionary-validated words to the model,
        # which prevents G2P failures on unknown words.
        effective_transcript = " ".join(recognized)
        if effective_transcript != transcript:
            logger.info(
                f"Using cleaned transcript for G2P: '{effective_transcript}' "
                f"(original: '{transcript}')"
            )

        # Get cached model (this ensures SOFA is in sys.path)
        manager = get_model_manager()
        cached = manager.get_or_load(ckpt_path, dict_path)

        # Now we can import SOFA modules after path is set up
        from modules.utils.load_wav import load_wav

        model = cached.model
        g2p = cached.g2p
        device = cached.device

        # Parse transcript using G2P with the cleaned (recognized-only) transcript
        try:
            ph_seq, word_seq, ph_idx_to_word_idx = g2p(effective_transcript)
        except Exception as e:
            raise AlignmentError(
                f"G2P failed for transcript '{effective_transcript}' "
                f"(original: '{transcript}'): {e}"
            ) from e

        # After G2P processing, check if we have any valid phonemes.
        # word_seq contains recognized words, ph_seq contains phonemes.
        # Since we already validated that 'recognized' is non-empty, this
        # should rarely trigger, but guards against G2P silently dropping words.
        if not word_seq:
            raise DictionaryValidationError(
                f"No words recognized after G2P processing for transcript "
                f"'{effective_transcript}' (original: '{transcript}')",
                unrecognized_phonemes=set(transcript.split()),
                transcript=transcript,
            )

        # Load and preprocess audio
        waveform = load_wav(
            str(audio_path), device, model.melspec_config["sample_rate"]
        )
        wav_length = waveform.shape[0] / model.melspec_config["sample_rate"]

        # Define inference as a callable for GPU OOM fallback
        ph_idx_to_word_idx_arr = np.array(ph_idx_to_word_idx)

        def _gpu_inference() -> tuple:
            with torch.no_grad():
                melspec = model.get_melspec(waveform).detach().unsqueeze(0)
                melspec = (melspec - melspec.mean()) / melspec.std()
                melspec = repeat(
                    melspec,
                    "B C T -> B C (T N)",
                    N=model.melspec_config["scale_factor"],
                )
                return model._infer_once(
                    melspec,
                    wav_length,
                    ph_seq,
                    word_seq,
                    ph_idx_to_word_idx_arr,
                    return_ctc=False,
                    return_plot=False,
                )

        def _cpu_inference(cpu_tensors: dict[str, torch.Tensor]) -> tuple:
            cpu_waveform = cpu_tensors["waveform"]
            with torch.no_grad():
                melspec = model.get_melspec(cpu_waveform).detach().unsqueeze(0)
                melspec = (melspec - melspec.mean()) / melspec.std()
                melspec = repeat(
                    melspec,
                    "B C T -> B C (T N)",
                    N=model.melspec_config["scale_factor"],
                )
                return model._infer_once(
                    melspec,
                    wav_length,
                    ph_seq,
                    word_seq,
                    ph_idx_to_word_idx_arr,
                    return_ctc=False,
                    return_plot=False,
                )

        # Generate mel spectrogram and run inference with GPU OOM fallback
        (
            ph_seq_pred,
            ph_intervals_pred,
            word_seq_pred,
            word_intervals_pred,
            confidence,
            _,  # ctc
            _,  # fig
        ) = run_inference_with_cpu_fallback(
            model=model,
            inference_fn=_gpu_inference,
            tensors_to_move={"waveform": waveform},
            cpu_inference_fn=_cpu_inference,
            context="SOFA forced alignment",
        )

        # Convert to PhonemeSegments
        segments: list[PhonemeSegment] = []
        for i, phoneme in enumerate(ph_seq_pred):
            if phoneme and phoneme not in ("", "SP", "AP", "sil", "sp", "spn"):
                segments.append(
                    PhonemeSegment(
                        phoneme=str(phoneme),
                        start_ms=float(ph_intervals_pred[i, 0]) * 1000,
                        end_ms=float(ph_intervals_pred[i, 1]) * 1000,
                        confidence=float(confidence),
                    )
                )

        # Convert word segments
        word_segments: list[dict] = []
        for i, word in enumerate(word_seq_pred):
            if word:
                word_segments.append(
                    {
                        "word": str(word),
                        "start_ms": float(word_intervals_pred[i, 0]) * 1000,
                        "end_ms": float(word_intervals_pred[i, 1]) * 1000,
                    }
                )

        audio_duration_ms = await self._get_audio_duration(audio_path)

        return AlignmentResult(
            segments=segments,
            audio_duration_ms=audio_duration_ms,
            method="sofa",
            word_segments=word_segments,
        )

    async def _infer_subprocess(
        self,
        audio_path: Path,
        transcript: str,
        language: str,
    ) -> AlignmentResult:
        """Run inference using subprocess (fallback mode).

        This method spawns a subprocess to run infer.py, which reloads
        the model on every call. Use native mode for better performance.

        Args:
            audio_path: Path to audio file (WAV)
            transcript: Text transcript
            language: Language code

        Returns:
            AlignmentResult with phoneme timestamps
        """
        ckpt_path, dict_path = self._get_model_paths(language)

        # Create temporary directory for SOFA input/output
        temp_dir = Path(tempfile.mkdtemp(prefix="sofa_"))
        self._temp_dirs.append(temp_dir)

        try:
            # Prepare input directory with WAV and LAB files
            segments_dir = temp_dir / "segments"
            segments_dir.mkdir()

            # Prepare audio (SOFA expects specific sample rate)
            prepared_audio = segments_dir / "audio.wav"
            await self._prepare_audio(audio_path, prepared_audio)

            # Create .lab file with transcript (same name as WAV)
            lab_file = segments_dir / "audio.lab"
            lab_file.write_text(transcript, encoding="utf-8")

            # Run SOFA inference
            # SOFA outputs TextGrid to the same folder as input
            assert self._sofa_path is not None  # Checked in is_available()
            cmd = [
                "python",
                str(self._sofa_path / "infer.py"),
                "--ckpt",
                str(ckpt_path),
                "--folder",
                str(segments_dir),
                "--dictionary",
                str(dict_path),
                "--out_formats",
                "TextGrid",
            ]

            logger.info(f"Running SOFA subprocess: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._sofa_path),  # Run from SOFA directory
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=120
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise AlignmentError(
                    "SOFA alignment timed out after 120s (possible GPU OOM)"
                )

            if process.returncode != 0:
                error_msg = (
                    stderr.decode()
                    if stderr
                    else stdout.decode()
                    if stdout
                    else "Unknown error"
                )
                logger.error(f"SOFA subprocess failed: {error_msg}")
                raise AlignmentError(f"SOFA alignment failed: {error_msg}")

            # Parse TextGrid output (SOFA writes to input folder)
            result = await self._parse_sofa_output(segments_dir, audio_path)
            return result

        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(temp_dir)
                if temp_dir in self._temp_dirs:
                    self._temp_dirs.remove(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp dir {temp_dir}: {e}")

    async def align(
        self,
        audio_path: Path,
        transcript: str,
        language: str = "ja",
    ) -> AlignmentResult:
        """Align transcript to audio using SOFA.

        Args:
            audio_path: Path to audio file (WAV)
            transcript: Text transcript of the audio (phoneme sequence)
            language: Language code (ja, en, zh, ko, fr)

        Returns:
            AlignmentResult with phoneme timestamps

        Raises:
            AlignmentError: If alignment fails
        """
        if not self.is_available():
            raise AlignmentError("SOFA is not installed or not properly configured")

        # Try native mode first (if enabled)
        if self._use_native:
            try:
                return await self._infer_native(audio_path, transcript, language)
            except Exception as e:
                logger.warning(
                    f"Native SOFA inference failed, falling back to subprocess: {e}"
                )
                # Fall through to subprocess mode

        # Subprocess fallback
        return await self._infer_subprocess(audio_path, transcript, language)

    async def batch_align(
        self,
        items: list[tuple[Path, str]],
        language: str = "ja",
    ) -> dict[Path, AlignmentResult]:
        """Align multiple audio files.

        When using native mode, each file is processed sequentially but
        the model is loaded only once (cached). When using subprocess mode,
        all files are processed in a single SOFA invocation.

        Args:
            items: List of (audio_path, transcript) tuples
            language: Language code (ja, en, zh, ko, fr)

        Returns:
            Dict mapping original audio paths to their AlignmentResult

        Raises:
            AlignmentError: If alignment fails for all files
        """
        if not items:
            return {}

        if not self.is_available():
            raise AlignmentError("SOFA is not installed or not properly configured")

        # Try native batch processing first
        if self._use_native:
            try:
                return await self._batch_align_native(items, language)
            except Exception as e:
                logger.warning(
                    f"Native SOFA batch failed, falling back to subprocess: {e}"
                )

        # Subprocess fallback
        return await self._batch_align_subprocess(items, language)

    async def _batch_align_native(
        self,
        items: list[tuple[Path, str]],
        language: str,
    ) -> dict[Path, AlignmentResult]:
        """Batch align using native mode (sequential, but model cached)."""
        results: dict[Path, AlignmentResult] = {}
        failed: list[tuple[Path, Exception]] = []
        skipped_dictionary: list[Path] = []

        for audio_path, transcript in items:
            try:
                result = await self._infer_native(audio_path, transcript, language)
                results[audio_path] = result
            except DictionaryValidationError as e:
                # Log at info level - this is expected for samples with
                # phonemes not in the dictionary (e.g., English samples
                # in Japanese voicebank)
                logger.info(
                    f"Skipping {audio_path.name}: phonemes not in dictionary "
                    f"({e.unrecognized_phonemes})"
                )
                skipped_dictionary.append(audio_path)
                failed.append((audio_path, e))
            except Exception as e:
                logger.warning(f"Native alignment failed for {audio_path}: {e}")
                failed.append((audio_path, e))

        if skipped_dictionary:
            logger.info(
                f"Batch alignment: {len(skipped_dictionary)} files skipped due to "
                "unrecognized phonemes (will use fallback alignment)"
            )

        if not results and failed:
            raise AlignmentError(
                f"All {len(failed)} files failed alignment. "
                f"First error: {failed[0][1]}"
            )

        if failed:
            logger.warning(
                f"Batch alignment: {len(failed)} of {len(items)} files failed"
            )

        return results

    async def _batch_align_subprocess(
        self,
        items: list[tuple[Path, str]],
        language: str,
    ) -> dict[Path, AlignmentResult]:
        """Batch align using subprocess mode (single SOFA invocation)."""
        ckpt_path, dict_path = self._get_model_paths(language)

        # Create temporary directory for batch processing
        temp_dir = Path(tempfile.mkdtemp(prefix="sofa_batch_"))
        self._temp_dirs.append(temp_dir)

        try:
            segments_dir = temp_dir / "segments"
            segments_dir.mkdir()

            # Map from temp filename (without extension) to original path
            filename_to_original: dict[str, Path] = {}

            # Prepare all audio files and lab files
            for idx, (audio_path, transcript) in enumerate(items):
                # Use index-based naming to avoid collisions
                base_name = f"audio_{idx:06d}"
                filename_to_original[base_name] = audio_path

                # Prepare audio
                prepared_audio = segments_dir / f"{base_name}.wav"
                await self._prepare_audio(audio_path, prepared_audio)

                # Create corresponding .lab file
                lab_file = segments_dir / f"{base_name}.lab"
                lab_file.write_text(transcript, encoding="utf-8")

            # Run SOFA inference once for all files
            assert self._sofa_path is not None
            cmd = [
                "python",
                str(self._sofa_path / "infer.py"),
                "--ckpt",
                str(ckpt_path),
                "--folder",
                str(segments_dir),
                "--dictionary",
                str(dict_path),
                "--out_formats",
                "TextGrid",
            ]

            logger.info(f"Running SOFA batch alignment for {len(items)} files")
            logger.debug(f"SOFA command: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._sofa_path),
            )

            # Batch alignment gets longer timeout (5 min) since it processes multiple files
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=300
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise AlignmentError(
                    f"SOFA batch alignment timed out after 300s for {len(items)} files "
                    "(possible GPU OOM)"
                )

            # Always log SOFA output for debugging
            if stdout:
                stdout_text = stdout.decode()
                if stdout_text.strip():
                    logger.debug(f"SOFA stdout: {stdout_text[:500]}")
            if stderr:
                stderr_text = stderr.decode()
                if stderr_text.strip():
                    logger.info(f"SOFA stderr: {stderr_text[:1000]}")

            if process.returncode != 0:
                error_msg = (
                    stderr.decode()
                    if stderr
                    else stdout.decode()
                    if stdout
                    else "Unknown error"
                )
                logger.error(f"SOFA batch alignment failed: {error_msg}")
                raise AlignmentError(f"SOFA batch alignment failed: {error_msg}")

            # Parse all TextGrid outputs and map back to original paths
            results: dict[Path, AlignmentResult] = {}
            failed_files: list[Path] = []

            for base_name, original_path in filename_to_original.items():
                textgrid_path = segments_dir / f"{base_name}.TextGrid"

                if textgrid_path.exists():
                    try:
                        result = await self._parse_textgrid(
                            textgrid_path, original_path
                        )
                        results[original_path] = result
                    except Exception as e:
                        logger.warning(
                            f"Failed to parse TextGrid for {original_path}: {e}"
                        )
                        failed_files.append(original_path)
                else:
                    logger.warning(f"No TextGrid output for {original_path}")
                    failed_files.append(original_path)

            if failed_files:
                logger.warning(
                    f"Batch alignment: {len(failed_files)} of {len(items)} files failed"
                )

            if not results:
                raise AlignmentError(
                    "SOFA batch alignment produced no results for any file"
                )

            return results

        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(temp_dir)
                if temp_dir in self._temp_dirs:
                    self._temp_dirs.remove(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp dir {temp_dir}: {e}")

    async def _prepare_audio(self, input_path: Path, output_path: Path) -> None:
        """Prepare audio for SOFA (44.1kHz mono WAV).

        Args:
            input_path: Source audio file
            output_path: Output path for prepared audio
        """
        # Load and resample to SOFA's expected sample rate
        audio, sr = librosa.load(str(input_path), sr=SOFA_SAMPLE_RATE, mono=True)

        # Normalize
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        # Save as WAV
        sf.write(str(output_path), audio, SOFA_SAMPLE_RATE)

    async def _parse_sofa_output(
        self,
        output_dir: Path,
        audio_path: Path,
    ) -> AlignmentResult:
        """Parse SOFA TextGrid output to AlignmentResult.

        Args:
            output_dir: SOFA output directory
            audio_path: Original audio path for duration

        Returns:
            AlignmentResult with parsed segments
        """
        # Find TextGrid output file
        textgrid_files = list(output_dir.glob("**/*.TextGrid"))
        if not textgrid_files:
            raise AlignmentError("No SOFA output TextGrid found")

        return await self._parse_textgrid(textgrid_files[0], audio_path)

    async def _parse_textgrid(
        self,
        textgrid_path: Path,
        audio_path: Path,
    ) -> AlignmentResult:
        """Parse TextGrid format output from SOFA.

        SOFA produces TextGrid files with phone-level alignments.
        The format follows the standard Praat TextGrid specification.

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

                        # Skip silence markers
                        if text and text not in ("", "sil", "sp", "spn", "SP", "AP"):
                            if "phone" in current_tier or "phoneme" in current_tier:
                                segments.append(
                                    PhonemeSegment(
                                        phoneme=text,
                                        start_ms=xmin * 1000,
                                        end_ms=xmax * 1000,
                                        confidence=1.0,  # SOFA doesn't provide confidence
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
            method="sofa",
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


# Module-level convenience functions


def get_sofa_aligner(
    sofa_path: Path | str | None = None,
    checkpoints_dir: Path | str | None = None,
    dictionary_dir: Path | str | None = None,
    use_native: bool = True,
) -> SOFAForcedAligner:
    """Get a SOFA aligner instance.

    Args:
        sofa_path: Path to SOFA repository
        checkpoints_dir: Path to checkpoint files
        dictionary_dir: Path to dictionary files
        use_native: If True, use native Python loading with caching

    Returns:
        SOFAForcedAligner instance
    """
    return SOFAForcedAligner(
        sofa_path=sofa_path,
        checkpoints_dir=checkpoints_dir,
        dictionary_dir=dictionary_dir,
        use_native=use_native,
    )


def is_sofa_available() -> bool:
    """Check if SOFA is available for use.

    Returns:
        True if SOFA can be used for alignment
    """
    aligner = SOFAForcedAligner()
    return aligner.is_available()


def clear_sofa_model_cache() -> None:
    """Clear the SOFA model cache to free memory."""
    manager = get_model_manager()
    manager.clear_cache()
