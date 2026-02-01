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

import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_aligner import AlignmentError, AlignmentResult, ForcedAligner

logger = logging.getLogger(__name__)

# Target sample rate for SOFA (16kHz mono, same as most forced aligners)
SOFA_SAMPLE_RATE = 16000

# Default SOFA paths
SOFA_MODELS_DIR = Path(__file__).parent.parent.parent.parent / "models" / "sofa"
SOFA_CHECKPOINTS_DIR = SOFA_MODELS_DIR / "checkpoints"
SOFA_DICTIONARY_DIR = SOFA_MODELS_DIR / "dictionary"


class SOFAForcedAligner(ForcedAligner):
    """SOFA (Singing-Oriented Forced Aligner) wrapper.

    SOFA is specifically designed for singing voice alignment and produces
    better results for sustained vowels and singing-specific phonation
    compared to speech-oriented aligners.

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
    ) -> None:
        """Initialize SOFA aligner.

        Args:
            sofa_path: Path to SOFA repository (or use SOFA_PATH env var)
            checkpoints_dir: Path to checkpoint files (default: models/sofa/checkpoints/)
            dictionary_dir: Path to dictionary files (default: models/sofa/dictionary/)
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

        self._temp_dirs: list[Path] = []

    def _find_sofa_installation(self) -> Path | None:
        """Try to find SOFA installation in common locations.

        Returns:
            Path to SOFA directory or None if not found
        """
        common_paths = [
            Path.home() / "SOFA",
            Path.home() / "sofa",
            Path("/opt/SOFA"),
            Path("/opt/sofa"),
            # Check if there's a sofa directory in models/
            SOFA_MODELS_DIR / "SOFA",
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

        ckpt_path, dict_path = self._get_model_paths(language)

        # Create temporary directory for SOFA input/output
        temp_dir = Path(tempfile.mkdtemp(prefix="sofa_"))
        self._temp_dirs.append(temp_dir)

        try:
            # Prepare input directory with WAV and LAB files
            segments_dir = temp_dir / "segments"
            segments_dir.mkdir()

            # Prepare audio (SOFA expects 16kHz mono WAV)
            prepared_audio = segments_dir / "audio.wav"
            await self._prepare_audio(audio_path, prepared_audio)

            # Create .lab file with transcript (same name as WAV)
            lab_file = segments_dir / "audio.lab"
            lab_file.write_text(transcript, encoding="utf-8")

            # Output directory for TextGrid
            output_dir = temp_dir / "output"
            output_dir.mkdir()

            # Run SOFA inference
            # SOFA CLI: python infer.py --ckpt <ckpt> --folder <segments> --dictionary <dict> --out_formats TextGrid
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
                "--save_dir",
                str(output_dir),
            ]

            logger.info(f"Running SOFA: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._sofa_path),  # Run from SOFA directory
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = (
                    stderr.decode()
                    if stderr
                    else stdout.decode()
                    if stdout
                    else "Unknown error"
                )
                logger.error(f"SOFA failed: {error_msg}")
                raise AlignmentError(f"SOFA alignment failed: {error_msg}")

            # Parse TextGrid output
            result = await self._parse_sofa_output(output_dir, audio_path)
            return result

        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(temp_dir)
                if temp_dir in self._temp_dirs:
                    self._temp_dirs.remove(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp dir {temp_dir}: {e}")

    async def _prepare_audio(self, input_path: Path, output_path: Path) -> None:
        """Prepare audio for SOFA (16kHz mono WAV).

        Args:
            input_path: Source audio file
            output_path: Output path for prepared audio
        """
        # Load and resample
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
) -> SOFAForcedAligner:
    """Get a SOFA aligner instance.

    Args:
        sofa_path: Path to SOFA repository
        checkpoints_dir: Path to checkpoint files
        dictionary_dir: Path to dictionary files

    Returns:
        SOFAForcedAligner instance
    """
    return SOFAForcedAligner(
        sofa_path=sofa_path,
        checkpoints_dir=checkpoints_dir,
        dictionary_dir=dictionary_dir,
    )


def is_sofa_available() -> bool:
    """Check if SOFA is available for use.

    Returns:
        True if SOFA can be used for alignment
    """
    aligner = SOFAForcedAligner()
    return aligner.is_available()
