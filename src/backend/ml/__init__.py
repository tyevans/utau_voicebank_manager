# ML package (model integrations)

from src.backend.ml.forced_aligner import (
    AlignmentError,
    AlignmentResult,
    ForcedAligner,
    ForcedAlignerFactory,
    MFAForcedAligner,
    Wav2Vec2ForcedAligner,
    align_audio,
    get_forced_aligner,
)
from src.backend.ml.forced_alignment_detector import (
    ForcedAlignmentDetector,
    ForcedAlignmentError,
    TranscriptExtractionError,
    TranscriptResult,
    detect_phonemes_forced,
    extract_transcript_from_filename,
    extract_transcript_with_metadata,
    get_forced_alignment_detector,
)
from src.backend.ml.oto_suggester import OtoSuggester, get_oto_suggester
from src.backend.ml.phoneme_detector import (
    AudioProcessingError,
    ModelNotLoadedError,
    PhonemeDetector,
    get_phoneme_detector,
)
from src.backend.ml.sofa_aligner import (
    DictionaryValidationError,
    SOFAForcedAligner,
    get_sofa_aligner,
    is_sofa_available,
)

__all__ = [
    # Forced alignment (MFA-based)
    "AlignmentError",
    "AlignmentResult",
    "ForcedAligner",
    "ForcedAlignerFactory",
    "MFAForcedAligner",
    "Wav2Vec2ForcedAligner",
    "align_audio",
    "get_forced_aligner",
    # SOFA (Singing-Oriented Forced Aligner)
    "DictionaryValidationError",
    "SOFAForcedAligner",
    "get_sofa_aligner",
    "is_sofa_available",
    # Forced alignment detector (TorchAudio MMS_FA)
    "ForcedAlignmentDetector",
    "ForcedAlignmentError",
    "TranscriptExtractionError",
    "TranscriptResult",
    "detect_phonemes_forced",
    "extract_transcript_from_filename",
    "extract_transcript_with_metadata",
    "get_forced_alignment_detector",
    # Oto suggestion
    "OtoSuggester",
    "get_oto_suggester",
    # Phoneme detection
    "AudioProcessingError",
    "ModelNotLoadedError",
    "PhonemeDetector",
    "get_phoneme_detector",
]
