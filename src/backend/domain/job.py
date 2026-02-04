"""Pydantic models for async job tracking.

Jobs represent long-running GPU tasks (e.g., voicebank generation)
that are queued via Redis and processed by a background worker.
Each job tracks its lifecycle from QUEUED through RUNNING to
COMPLETED or FAILED, with optional progress updates.
"""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(UTC)


class JobStatus(str, Enum):
    """Job lifecycle status."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobType(str, Enum):
    """Types of jobs the worker can process."""

    GENERATE_VOICEBANK = "generate_voicebank"


class JobProgress(BaseModel):
    """Progress update for a running job.

    Sent periodically by the worker to indicate how far along
    the job has progressed.
    """

    percent: float = Field(
        ge=0,
        le=100,
        description="Completion percentage (0-100)",
    )
    message: str = Field(
        default="",
        description="Human-readable status message",
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        description="When this progress update was recorded",
    )


class JobResult(BaseModel):
    """Result data stored when a job completes or fails.

    On success, `data` contains the result payload.
    On failure, `error` contains the error message.
    """

    success: bool = Field(
        description="Whether the job completed successfully",
    )
    data: dict[str, Any] | None = Field(
        default=None,
        description="Result payload on success",
    )
    error: str | None = Field(
        default=None,
        description="Error message on failure",
    )


class Job(BaseModel):
    """A tracked async job.

    Represents a unit of work submitted to the GPU worker queue.
    Jobs are created by API routes, stored in Redis, and picked
    up by the worker process for execution.
    """

    id: UUID = Field(
        default_factory=uuid4,
        description="Unique job identifier",
    )
    type: JobType = Field(
        description="The kind of work this job performs",
    )
    status: JobStatus = Field(
        default=JobStatus.QUEUED,
        description="Current lifecycle status",
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Job input parameters",
    )
    progress: JobProgress | None = Field(
        default=None,
        description="Latest progress update (None if not yet started)",
    )
    result: JobResult | None = Field(
        default=None,
        description="Final result (None until completed or failed)",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="When the job was submitted",
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        description="Last modification time",
    )


class GenerateVoicebankParams(BaseModel):
    """Parameters for the generate_voicebank job type.

    Specifies which recording session to generate from and
    how the output voicebank should be configured.
    """

    session_id: UUID = Field(
        description="Recording session to generate voicebank from",
    )
    voicebank_name: str = Field(
        min_length=1,
        max_length=100,
        description="Display name for the generated voicebank",
    )
    output_path: str | None = Field(
        default=None,
        description="Optional custom output path for the voicebank",
    )
    include_character_txt: bool = Field(
        default=True,
        description="Whether to include character.txt metadata file",
    )
    encoding: str = Field(
        default="utf-8",
        description="Encoding for oto.ini file (utf-8 or cp932 for legacy UTAU)",
    )
