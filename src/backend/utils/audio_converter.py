"""Audio format conversion utilities.

Handles conversion between browser audio formats (WebM/Opus) and WAV
for UTAU voicebank compatibility.
"""

import asyncio
import shutil
import tempfile
from pathlib import Path


class AudioConversionError(Exception):
    """Raised when audio conversion fails."""


def is_wav(data: bytes) -> bool:
    """Check if data is a valid WAV file.

    Args:
        data: Raw audio bytes

    Returns:
        True if data starts with WAV header
    """
    if len(data) < 12:
        return False
    return data[:4] == b"RIFF" and data[8:12] == b"WAVE"


def is_webm(data: bytes) -> bool:
    """Check if data is a WebM file.

    Args:
        data: Raw audio bytes

    Returns:
        True if data starts with WebM header
    """
    if len(data) < 4:
        return False
    # WebM files start with EBML header (0x1A45DFA3)
    return data[:4] == b"\x1a\x45\xdf\xa3"


def is_ogg(data: bytes) -> bool:
    """Check if data is an Ogg file.

    Args:
        data: Raw audio bytes

    Returns:
        True if data starts with Ogg header
    """
    if len(data) < 4:
        return False
    return data[:4] == b"OggS"


def detect_audio_format(data: bytes) -> str:
    """Detect audio format from raw bytes.

    Args:
        data: Raw audio bytes

    Returns:
        Format string: 'wav', 'webm', 'ogg', or 'unknown'
    """
    if is_wav(data):
        return "wav"
    if is_webm(data):
        return "webm"
    if is_ogg(data):
        return "ogg"
    return "unknown"


def _get_ffmpeg_path() -> str | None:
    """Get path to ffmpeg executable.

    Returns:
        Path to ffmpeg or None if not found
    """
    return shutil.which("ffmpeg")


async def convert_to_wav(
    audio_data: bytes,
    sample_rate: int = 44100,
    channels: int = 1,
) -> bytes:
    """Convert audio data to WAV format.

    Uses ffmpeg for conversion. Handles WebM, Ogg, and other formats
    that browsers may produce via MediaRecorder.

    Args:
        audio_data: Raw audio bytes (any format ffmpeg supports)
        sample_rate: Target sample rate (default 44100 for UTAU)
        channels: Number of channels (default 1 for mono)

    Returns:
        WAV file bytes

    Raises:
        AudioConversionError: If conversion fails or ffmpeg not found
    """
    # Already WAV? Return as-is
    if is_wav(audio_data):
        return audio_data

    ffmpeg_path = _get_ffmpeg_path()
    if not ffmpeg_path:
        raise AudioConversionError(
            "ffmpeg not found. Please install ffmpeg for audio conversion."
        )

    # Detect input format for better error messages
    input_format = detect_audio_format(audio_data)
    if input_format == "unknown":
        # Try anyway - ffmpeg might recognize it
        pass

    # Create temp files for conversion
    with tempfile.NamedTemporaryFile(
        suffix=f".{input_format if input_format != 'unknown' else 'audio'}",
        delete=False,
    ) as input_file:
        input_path = Path(input_file.name)
        input_file.write(audio_data)

    output_path = input_path.with_suffix(".wav")

    try:
        # Run ffmpeg conversion
        # -y: overwrite output
        # -i: input file
        # -ar: sample rate
        # -ac: audio channels
        # -c:a pcm_s16le: 16-bit PCM (standard WAV)
        process = await asyncio.create_subprocess_exec(
            ffmpeg_path,
            "-y",
            "-i",
            str(input_path),
            "-ar",
            str(sample_rate),
            "-ac",
            str(channels),
            "-c:a",
            "pcm_s16le",
            str(output_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        _, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="replace")
            raise AudioConversionError(
                f"ffmpeg conversion failed (format: {input_format}): {error_msg}"
            )

        # Read converted WAV
        wav_data = output_path.read_bytes()

        if not is_wav(wav_data):
            raise AudioConversionError("Conversion produced invalid WAV output")

        return wav_data

    finally:
        # Clean up temp files
        input_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)


def convert_to_wav_sync(
    audio_data: bytes,
    sample_rate: int = 44100,
    channels: int = 1,
) -> bytes:
    """Synchronous version of convert_to_wav.

    Args:
        audio_data: Raw audio bytes
        sample_rate: Target sample rate
        channels: Number of channels

    Returns:
        WAV file bytes

    Raises:
        AudioConversionError: If conversion fails
    """
    import subprocess

    if is_wav(audio_data):
        return audio_data

    ffmpeg_path = _get_ffmpeg_path()
    if not ffmpeg_path:
        raise AudioConversionError(
            "ffmpeg not found. Please install ffmpeg for audio conversion."
        )

    input_format = detect_audio_format(audio_data)

    with tempfile.NamedTemporaryFile(
        suffix=f".{input_format if input_format != 'unknown' else 'audio'}",
        delete=False,
    ) as input_file:
        input_path = Path(input_file.name)
        input_file.write(audio_data)

    output_path = input_path.with_suffix(".wav")

    try:
        result = subprocess.run(
            [
                ffmpeg_path,
                "-y",
                "-i",
                str(input_path),
                "-ar",
                str(sample_rate),
                "-ac",
                str(channels),
                "-c:a",
                "pcm_s16le",
                str(output_path),
            ],
            capture_output=True,
        )

        if result.returncode != 0:
            error_msg = result.stderr.decode("utf-8", errors="replace")
            raise AudioConversionError(
                f"ffmpeg conversion failed (format: {input_format}): {error_msg}"
            )

        wav_data = output_path.read_bytes()

        if not is_wav(wav_data):
            raise AudioConversionError("Conversion produced invalid WAV output")

        return wav_data

    finally:
        input_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
