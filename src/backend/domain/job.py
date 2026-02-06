"""Pydantic models for async job tracking.

Jobs represent long-running GPU tasks (e.g., voicebank generation)
that are queued via Redis and processed by a background worker.
Each job tracks its lifecycle from QUEUED through RUNNING to
COMPLETED or FAILED, with optional progress updates.

Job parameters use a Pydantic discriminated union keyed on ``job_type``
so that each job type carries its own validated schema instead of a
loose ``dict[str, Any]``.
"""

from datetime import UTC, datetime
from enum import Enum
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, EmailStr, Field, model_validator


def _utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(UTC)


class JobStatus(str, Enum):
    """Job lifecycle status."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    DEAD_LETTER = "dead_letter"


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


# ---------------------------------------------------------------------------
# Typed job parameters — discriminated union keyed on ``job_type``
# ---------------------------------------------------------------------------


class GenerateVoicebankParams(BaseModel):
    """Parameters for the generate_voicebank job type.

    Specifies which recording session to generate from and
    how the output voicebank should be configured.
    """

    job_type: Literal["generate_voicebank"] = Field(
        default="generate_voicebank",
        description="Discriminator field identifying this parameter type",
    )
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
    notification_email: EmailStr | None = Field(
        default=None,
        description="Email address to notify when the job completes",
    )


# Discriminated union of all job parameter types. Add new variants here
# as new job types are introduced.
JobParams = Annotated[
    GenerateVoicebankParams,
    Field(discriminator="job_type"),
]
"""Union of all typed job parameter models.

Currently only ``GenerateVoicebankParams`` exists. When a second job type
is added, expand this to ``GenerateVoicebankParams | NewJobParams`` and
Pydantic will route deserialization via the ``job_type`` discriminator.
"""


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
    params: JobParams = Field(
        description="Typed job input parameters (discriminated on job_type)",
    )
    progress: JobProgress | None = Field(
        default=None,
        description="Latest progress update (None if not yet started)",
    )
    result: JobResult | None = Field(
        default=None,
        description="Final result (None until completed or failed)",
    )

    priority: int = Field(
        default=0,
        ge=0,
        le=10,
        description="Job priority (0 = default, 10 = highest). Higher priority "
        "jobs are picked up first by the worker.",
    )
    timeout_seconds: int = Field(
        default=3600,
        gt=0,
        description="Maximum wall-clock time in seconds before the job is "
        "considered timed out (default 1 hour)",
    )
    worker_id: str | None = Field(
        default=None,
        description="Identifier of the worker currently processing this job. "
        "None while queued, set when a worker picks up the job.",
    )

    retry_count: int = Field(
        default=0,
        ge=0,
        description="Number of retries attempted so far",
    )
    max_retries: int = Field(
        default=3,
        ge=0,
        description="Maximum number of retries before dead-lettering",
    )
    last_error: str | None = Field(
        default=None,
        description="Error message from the most recent failed attempt",
    )

    created_at: datetime = Field(
        default_factory=_utc_now,
        description="When the job was submitted",
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        description="Last modification time",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_params(cls, data: Any) -> Any:
        """Support deserialization of legacy jobs stored with untyped params.

        Old jobs were serialized with ``params`` as a plain dict without
        a ``job_type`` discriminator. This validator injects the
        discriminator from the ``type`` field so Pydantic can route to
        the correct params model.
        """
        if not isinstance(data, dict):
            return data

        params = data.get("params")
        if isinstance(params, dict) and "job_type" not in params:
            # Infer job_type from the top-level ``type`` field
            job_type = data.get("type")
            if job_type is not None:
                # Handle both enum value strings and JobType enum instances
                if hasattr(job_type, "value"):
                    params["job_type"] = job_type.value
                else:
                    params["job_type"] = job_type
        return data
