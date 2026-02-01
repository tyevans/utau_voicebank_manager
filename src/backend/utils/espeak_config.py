"""eSpeak configuration for Windows systems.

The phonemizer library requires eSpeak NG to be installed and discoverable.
On Windows, this module detects the installation path and configures the
environment variables needed by phonemizer.

This module should be imported early in the application startup.
"""

import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _find_espeak_windows() -> Path | None:
    """Search for eSpeak NG installation on Windows.

    Returns:
        Path to eSpeak NG installation directory, or None if not found.
    """
    # Common installation paths
    search_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "eSpeak NG",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"))
        / "eSpeak NG",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "eSpeak NG",
        # User might have it in a custom location via PATH
    ]

    for path in search_paths:
        if path.exists():
            # Verify it's a valid installation by checking for key files
            espeak_exe = path / "espeak-ng.exe"
            espeak_dll = path / "libespeak-ng.dll"
            if espeak_exe.exists() or espeak_dll.exists():
                return path

    # Try to find via PATH
    path_dirs = os.environ.get("PATH", "").split(os.pathsep)
    for dir_str in path_dirs:
        dir_path = Path(dir_str)
        if (dir_path / "espeak-ng.exe").exists():
            return dir_path

    return None


def configure_espeak() -> bool:
    """Configure eSpeak for phonemizer on Windows.

    Sets the necessary environment variables for the phonemizer library
    to find eSpeak NG.

    Returns:
        True if eSpeak was found and configured, False otherwise.
    """
    if sys.platform != "win32":
        # Not Windows, eSpeak should work via system package manager
        return True

    # Check if already configured
    if os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"):
        logger.debug("eSpeak already configured via PHONEMIZER_ESPEAK_LIBRARY")
        return True

    espeak_path = _find_espeak_windows()
    if espeak_path is None:
        logger.warning(
            "eSpeak NG not found on Windows. "
            "AI phoneme detection may not work. "
            "Install from: https://github.com/espeak-ng/espeak-ng/releases"
        )
        return False

    # Set environment variables for phonemizer
    dll_path = espeak_path / "libespeak-ng.dll"
    if dll_path.exists():
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = str(dll_path)
        logger.info(f"Configured eSpeak library: {dll_path}")

    # Also add to PATH for subprocess calls
    current_path = os.environ.get("PATH", "")
    if str(espeak_path) not in current_path:
        os.environ["PATH"] = f"{espeak_path}{os.pathsep}{current_path}"
        logger.debug(f"Added eSpeak to PATH: {espeak_path}")

    # Set espeak-ng data path
    data_path = espeak_path / "espeak-ng-data"
    if data_path.exists():
        os.environ["ESPEAK_DATA_PATH"] = str(data_path)
        logger.debug(f"Set ESPEAK_DATA_PATH: {data_path}")

    return True


def get_espeak_status() -> dict[str, str | bool | None]:
    """Get the current eSpeak configuration status.

    Returns:
        Dictionary with configuration details.
    """
    status: dict[str, str | bool | None] = {
        "platform": sys.platform,
        "espeak_configured": False,
        "espeak_library": os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"),
        "espeak_data_path": os.environ.get("ESPEAK_DATA_PATH"),
    }

    if sys.platform == "win32":
        espeak_path = _find_espeak_windows()
        status["espeak_path"] = str(espeak_path) if espeak_path else None
        status["espeak_configured"] = espeak_path is not None
    else:
        # On Linux/Mac, assume it's available via system
        status["espeak_configured"] = True

    return status


# Auto-configure on import
_configured = configure_espeak()
