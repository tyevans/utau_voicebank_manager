# Domain models package (Pydantic models)

from src.backend.domain.alignment_config import AlignmentConfig, AlignmentParams
from src.backend.domain.batch_oto import BatchOtoRequest, BatchOtoResult
from src.backend.domain.generated_voicebank import (
    GeneratedVoicebank,
    GenerateVoicebankRequest,
    SlicedSample,
)
from src.backend.domain.job import (
    GenerateVoicebankParams,
    Job,
    JobParams,
    JobProgress,
    JobResult,
    JobStatus,
    JobType,
)
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.oto_suggestion import OtoSuggestion, OtoSuggestionRequest
from src.backend.domain.pagination import PaginatedResponse
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
from src.backend.domain.utau import (
    CharacterMetadata,
    PhonemeInventory,
    PrefixMap,
    PrefixMapEntry,
    SampleQualityMetrics,
)
from src.backend.domain.voicebank import (
    Language,
    RecordingStyle,
    Voicebank,
    VoicebankCreate,
    VoicebankRelease,
    VoicebankSummary,
)

__all__ = [
    "AlignmentConfig",
    "AlignmentParams",
    "BatchOtoRequest",
    "BatchOtoResult",
    "CVCoverage",
    "CharacterMetadata",
    "GenerateVoicebankParams",
    "GenerateVoicebankRequest",
    "GeneratedVoicebank",
    "Job",
    "JobParams",
    "JobProgress",
    "JobResult",
    "JobStatus",
    "JobType",
    "Language",
    "OtoEntry",
    "OtoSuggestion",
    "OtoSuggestionRequest",
    "PaginatedResponse",
    "ParagraphLibrary",
    "ParagraphPrompt",
    "ParagraphRecordingProgress",
    "PhonemeCoverage",
    "PhonemeDetectionResult",
    "PhonemeInventory",
    "PhonemePrompt",
    "PhonemeSegment",
    "PrefixMap",
    "PrefixMapEntry",
    "PromptLibrary",
    "RecordingSegment",
    "RecordingStyle",
    "RecordingSession",
    "RecordingSessionCreate",
    "RecordingSessionSummary",
    "SampleQualityMetrics",
    "SegmentUpload",
    "SessionProgress",
    "SessionStatus",
    "SlicedSample",
    "VCVCoverage",
    "Voicebank",
    "VoicebankCreate",
    "VoicebankRelease",
    "VoicebankSummary",
    "Word",
]
