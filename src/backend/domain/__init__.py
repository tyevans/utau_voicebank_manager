# Domain models package (Pydantic models)

from src.backend.domain.alignment_config import AlignmentConfig, AlignmentParams
from src.backend.domain.batch_oto import BatchOtoRequest, BatchOtoResult
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.oto_suggestion import OtoSuggestion, OtoSuggestionRequest
from src.backend.domain.paragraph_prompt import (
    ParagraphLibrary,
    ParagraphPrompt,
    ParagraphRecordingProgress,
    Word,
)
from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.domain.prompt import (
    CVCoverage,
    PhonemeCoverage,
    PhonemePrompt,
    PromptLibrary,
    VCVCoverage,
)
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    RecordingSessionSummary,
    SegmentUpload,
    SessionProgress,
    SessionStatus,
)
from src.backend.domain.voicebank import Voicebank, VoicebankCreate, VoicebankSummary

__all__ = [
    "AlignmentConfig",
    "AlignmentParams",
    "BatchOtoRequest",
    "BatchOtoResult",
    "CVCoverage",
    "OtoEntry",
    "OtoSuggestion",
    "OtoSuggestionRequest",
    "ParagraphLibrary",
    "ParagraphPrompt",
    "ParagraphRecordingProgress",
    "PhonemeCoverage",
    "PhonemeDetectionResult",
    "PhonemePrompt",
    "PhonemeSegment",
    "PromptLibrary",
    "RecordingSegment",
    "RecordingSession",
    "RecordingSessionCreate",
    "RecordingSessionSummary",
    "SegmentUpload",
    "SessionProgress",
    "SessionStatus",
    "VCVCoverage",
    "Voicebank",
    "VoicebankCreate",
    "VoicebankSummary",
    "Word",
]
