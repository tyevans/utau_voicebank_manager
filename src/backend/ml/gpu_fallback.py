"""GPU OOM graceful fallback utilities for ML inference.

When CUDA runs out of memory during inference, these utilities catch the
RuntimeError, clean up GPU memory, move the model and inputs to CPU, and
retry inference. This prevents entire batches from failing due to transient
GPU memory pressure.

Usage:
    from src.backend.ml.gpu_fallback import run_inference_with_cpu_fallback

    result = run_inference_with_cpu_fallback(
        model=model,
        inference_fn=lambda: model(input_values),
        tensors_to_move={"input_values": input_values},
    )
"""

import logging
from collections.abc import Callable
from typing import TypeVar

import torch

logger = logging.getLogger(__name__)

T = TypeVar("T")


def is_cuda_oom(error: RuntimeError) -> bool:
    """Check if a RuntimeError is a CUDA out-of-memory error.

    CUDA OOM errors contain specific substrings in their message.
    This handles both standard CUDA OOM and cuDNN-related OOM.

    Args:
        error: The RuntimeError to check

    Returns:
        True if the error is a CUDA OOM error
    """
    message = str(error).lower()
    return "out of memory" in message or ("cuda" in message and "alloc" in message)


def move_model_to_cpu(model: torch.nn.Module) -> torch.nn.Module:
    """Move a model to CPU and return it.

    Args:
        model: The PyTorch model to move

    Returns:
        The model on CPU
    """
    model.to(torch.device("cpu"))
    return model


def move_tensors_to_cpu(tensors: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Move a dictionary of tensors to CPU.

    Args:
        tensors: Dictionary mapping names to tensors

    Returns:
        New dictionary with all tensors moved to CPU
    """
    return {name: t.to(torch.device("cpu")) for name, t in tensors.items()}


def run_inference_with_cpu_fallback(
    model: torch.nn.Module,
    inference_fn: Callable[[], T],
    tensors_to_move: dict[str, torch.Tensor] | None = None,
    cpu_inference_fn: Callable[[dict[str, torch.Tensor]], T] | None = None,
    context: str = "",
) -> T:
    """Run GPU inference with automatic CPU fallback on CUDA OOM.

    First attempts to run inference_fn on the current device (typically GPU).
    If a CUDA OOM RuntimeError occurs, cleans up GPU memory, moves the model
    and tensors to CPU, and retries using cpu_inference_fn.

    Args:
        model: The PyTorch model (will be moved to CPU on OOM)
        inference_fn: Callable that runs the GPU inference and returns results.
                     Called with no arguments on the first (GPU) attempt.
        tensors_to_move: Optional dict of named tensors that need to be moved
                        to CPU alongside the model. Keys are names for logging,
                        values are the tensors.
        cpu_inference_fn: Callable that runs inference on CPU. Receives a dict
                         of CPU tensors (same keys as tensors_to_move) and
                         returns results. If None and OOM occurs, the model and
                         tensors are moved to CPU but inference_fn is retried
                         as-is (only works if inference_fn closes over mutable
                         references that get updated by the move).
        context: Optional string describing the inference for log messages
                (e.g., "Wav2Vec2 phoneme detection", "SOFA alignment").

    Returns:
        The result of inference_fn or cpu_inference_fn

    Raises:
        RuntimeError: If the error is not a CUDA OOM, or if CPU inference
                     also fails.
    """
    ctx = f" ({context})" if context else ""

    try:
        return inference_fn()
    except RuntimeError as e:
        if not is_cuda_oom(e):
            raise

        logger.warning(
            f"CUDA out of memory during inference{ctx}. "
            "Falling back to CPU. This will be slower but should complete."
        )

        # Clean up GPU memory
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        # Move model to CPU
        move_model_to_cpu(model)
        logger.info(f"Model moved to CPU{ctx}")

        # Move tensors to CPU
        cpu_tensors: dict[str, torch.Tensor] = {}
        if tensors_to_move:
            cpu_tensors = move_tensors_to_cpu(tensors_to_move)
            logger.debug(
                f"Moved {len(cpu_tensors)} tensor(s) to CPU: "
                f"{list(cpu_tensors.keys())}"
            )

        # Retry on CPU
        if cpu_inference_fn is not None:
            return cpu_inference_fn(cpu_tensors)
        else:
            return inference_fn()
