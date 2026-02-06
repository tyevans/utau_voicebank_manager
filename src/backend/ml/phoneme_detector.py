"""Phoneme detection using Wav2Vec2 models."""

import logging
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

import librosa
import numpy as np
import torch

from src.backend.domain.phoneme import PhonemeDetectionResult, PhonemeSegment
from src.backend.ml.gpu_fallback import run_inference_with_cpu_fallback
from src.backend.ml.model_registry import get_model_config

if TYPE_CHECKING:
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
else:
    # For runtime type annotations when TYPE_CHECKING is False
    Wav2Vec2ForCTC = object
    Wav2Vec2Processor = object

logger = logging.getLogger(__name__)

# Model configuration from centralized registry (pinned revision)
_WAV2VEC2_CONFIG = get_model_config("wav2vec2-phoneme")
DEFAULT_MODEL_NAME = _WAV2VEC2_CONFIG.model_id
DEFAULT_MODEL_REVISION = _WAV2VEC2_CONFIG.revision

# Target sample rate for Wav2Vec2 models
TARGET_SAMPLE_RATE = 16000

# Wav2Vec2 frame duration in milliseconds
# The model uses 7 conv layers with total stride of 320 samples
# At 16kHz: 320 / 16000 = 0.02 seconds = 20ms per frame
WAV2VEC2_FRAME_DURATION_MS = 20.0

# Cache directory for downloaded models (from registry)
MODELS_DIR = _WAV2VEC2_CONFIG.cache_dir


class ModelNotLoadedError(Exception):
    """Raised when attempting to use a model that failed to load."""

    pass


class AudioProcessingError(Exception):
    """Raised when audio file cannot be processed."""

    pass


@lru_cache(maxsize=1)
def get_wav2vec2_model(
    model_name: str = DEFAULT_MODEL_NAME,
) -> tuple["Wav2Vec2ForCTC", "Wav2Vec2Processor"]:
    """Load and cache Wav2Vec2 model and processor.

    Uses LRU cache to ensure model is only loaded once per session.
    Models are downloaded to the models/ directory for reuse.
    The model revision is pinned via the centralized model registry
    to prevent silent behavior changes from upstream updates.

    Args:
        model_name: HuggingFace model identifier

    Returns:
        Tuple of (model, processor)

    Raises:
        ModelNotLoadedError: If model fails to load
    """
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    revision = DEFAULT_MODEL_REVISION
    logger.info(
        f"Loading Wav2Vec2 model: {model_name} "
        f"(revision: {revision[:12] if revision else 'latest'})"
    )

    # Ensure cache directory exists
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        processor = Wav2Vec2Processor.from_pretrained(
            model_name,
            revision=revision,
            cache_dir=str(MODELS_DIR),
        )
        model = Wav2Vec2ForCTC.from_pretrained(
            model_name,
            revision=revision,
            cache_dir=str(MODELS_DIR),
        )

        # Move to GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        model.eval()

        logger.info(f"Model loaded successfully on {device}")
        return model, processor

    except Exception as e:
        logger.exception(f"Failed to load model {model_name}")
        raise ModelNotLoadedError(f"Failed to load model: {e}") from e


def preprocess_audio(
    file_path: Path,
    target_sr: int = TARGET_SAMPLE_RATE,
) -> tuple[np.ndarray, int, float]:
    """Load and preprocess audio for Wav2Vec2 inference.

    Args:
        file_path: Path to the audio file
        target_sr: Target sample rate (default 16kHz for Wav2Vec2)

    Returns:
        Tuple of (audio_array, sample_rate, duration_ms)

    Raises:
        AudioProcessingError: If audio cannot be loaded or processed
    """
    try:
        # Load audio with librosa, resampling to target rate
        # mono=True handles stereo->mono conversion
        audio, sr = librosa.load(str(file_path), sr=target_sr, mono=True)

        # Calculate duration in milliseconds
        duration_ms = (len(audio) / sr) * 1000

        # Normalize audio to [-1, 1] range
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        return audio, sr, duration_ms

    except Exception as e:
        logger.exception(f"Failed to process audio file: {file_path}")
        raise AudioProcessingError(f"Failed to process audio: {e}") from e


class PhonemeDetector:
    """Detects phonemes from audio using Wav2Vec2.

    This detector uses the facebook/wav2vec2-lv-60-espeak-cv-ft model
    which outputs IPA phonemes with timing information.
    """

    def __init__(self, model_name: str = DEFAULT_MODEL_NAME):
        """Initialize the phoneme detector.

        Args:
            model_name: HuggingFace model identifier for Wav2Vec2
        """
        self.model_name = model_name
        self._model: Wav2Vec2ForCTC | None = None
        self._processor: Wav2Vec2Processor | None = None

    def _ensure_model_loaded(self) -> tuple["Wav2Vec2ForCTC", "Wav2Vec2Processor"]:
        """Ensure model is loaded, loading lazily if needed."""
        if self._model is None or self._processor is None:
            self._model, self._processor = get_wav2vec2_model(self.model_name)
        return self._model, self._processor

    async def detect_phonemes(self, audio_path: Path) -> PhonemeDetectionResult:
        """Detect phonemes with timestamps from an audio file.

        Args:
            audio_path: Path to the audio file (WAV recommended)

        Returns:
            PhonemeDetectionResult containing detected segments

        Raises:
            ModelNotLoadedError: If model cannot be loaded
            AudioProcessingError: If audio file cannot be processed
        """
        model, processor = self._ensure_model_loaded()

        # Load and preprocess audio
        audio, sample_rate, duration_ms = preprocess_audio(audio_path)

        # Prepare input for model
        inputs = processor(
            audio,
            sampling_rate=sample_rate,
            return_tensors="pt",
            padding=True,
        )

        # Move inputs to same device as model
        device = next(model.parameters()).device
        input_values = inputs.input_values.to(device)

        # Run inference with GPU OOM fallback to CPU
        def _gpu_inference() -> tuple:
            with torch.no_grad():
                outputs = model(input_values)
                logits = outputs.logits
            predicted_ids = torch.argmax(logits, dim=-1)
            probs = torch.softmax(logits, dim=-1)
            max_probs = torch.max(probs, dim=-1).values
            return predicted_ids, max_probs

        def _cpu_inference(cpu_tensors: dict[str, torch.Tensor]) -> tuple:
            cpu_input = cpu_tensors["input_values"]
            with torch.no_grad():
                outputs = model(cpu_input)
                logits = outputs.logits
            predicted_ids = torch.argmax(logits, dim=-1)
            probs = torch.softmax(logits, dim=-1)
            max_probs = torch.max(probs, dim=-1).values
            return predicted_ids, max_probs

        try:
            predicted_ids, max_probs = run_inference_with_cpu_fallback(
                model=model,
                inference_fn=_gpu_inference,
                tensors_to_move={"input_values": input_values},
                cpu_inference_fn=_cpu_inference,
                context="Wav2Vec2 phoneme detection",
            )

            # Decode to phoneme segments with timestamps
            segments = self._decode_with_timestamps(
                predicted_ids[0],
                max_probs[0],
                processor,
                duration_ms,
            )

            return PhonemeDetectionResult(
                segments=segments,
                audio_duration_ms=duration_ms,
                model_name=self.model_name,
            )

        finally:
            # Clean up GPU memory
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    def _decode_with_timestamps(
        self,
        predicted_ids: torch.Tensor,
        probs: torch.Tensor,
        processor: "Wav2Vec2Processor",
        duration_ms: float,
    ) -> list[PhonemeSegment]:
        """Decode model output to phoneme segments with timestamps.

        Args:
            predicted_ids: Tensor of predicted token IDs
            probs: Tensor of prediction probabilities
            processor: Wav2Vec2 processor for decoding
            duration_ms: Total audio duration in milliseconds

        Returns:
            List of PhonemeSegment objects
        """
        segments: list[PhonemeSegment] = []

        # Use fixed frame duration for Wav2Vec2
        # The model architecture produces frames at a fixed 20ms interval
        # (320-sample stride at 16kHz = 20ms)
        # Do NOT calculate from duration/num_frames as that causes timestamp compression
        ms_per_frame = WAV2VEC2_FRAME_DURATION_MS

        # Get vocabulary for decoding
        vocab = processor.tokenizer.get_vocab()
        id_to_token = {v: k for k, v in vocab.items()}

        # CTC blank token ID (typically 0)
        blank_id = processor.tokenizer.pad_token_id

        # Group consecutive identical tokens
        current_token_id: int | None = None
        current_start_frame = 0
        current_probs: list[float] = []

        predicted_ids_list = predicted_ids.cpu().tolist()
        probs_list = probs.cpu().tolist()

        for frame_idx, (token_id, prob) in enumerate(
            zip(predicted_ids_list, probs_list, strict=True)
        ):
            if token_id == blank_id:
                # End current segment if we have one
                if current_token_id is not None and current_token_id != blank_id:
                    phoneme = id_to_token.get(current_token_id, "<unk>")
                    # Skip special tokens
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
                # End previous segment
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
                # Start new segment
                current_token_id = token_id
                current_start_frame = frame_idx
                current_probs = [prob]
            else:
                # Continue current segment
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


# Module-level singleton for convenience
_default_detector: PhonemeDetector | None = None


def get_phoneme_detector() -> PhonemeDetector:
    """Get the default phoneme detector singleton.

    Returns:
        PhonemeDetector instance
    """
    global _default_detector
    if _default_detector is None:
        _default_detector = PhonemeDetector()
    return _default_detector
