# Domain models package (Pydantic models)

from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment

__all__ = ["OtoEntry", "PhonemeDetectionResult", "PhonemeSegment"]
