"""Pydantic models for recording sessions.

Recording sessions track guided recording flows where users record audio
segments against prompts to build voicebank samples. Supports both
individual phoneme prompts and paragraph-based recording modes.
"""

from datetime import UTC, datetime
from enum import Enum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator

from src.backend.domain.voicebank import Language, RecordingStyle


def _utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(UTC)


class SessionStatus(str, Enum):
    """Status of a recording session."""

    PENDING = "pending"  # Created but not started
    RECORDING = "recording"  # Actively recording segments
    PROCESSING = "processing"  # Audio processing/alignment in progress
    COMPLETED = "completed"  # All segments recorded and processed
    CANCELLED = "cancelled"  # Aborted by user


class RecordingSegment(BaseModel):
    """A single recorded audio segment within a session.

    Represents one recorded utterance, typically corresponding to
    one prompt line (e.g., one CV mora or VCV phrase).
    """

    id: UUID = Field(default_factory=uuid4, description="Unique segment identifier")
    prompt_index: int = Field(ge=0, description="Index into session prompt list")
    prompt_text: str = Field(description="The text that was read")
    audio_filename: str = Field(description="Filename of recorded WAV")
    duration_ms: float = Field(ge=0, description="Audio duration in milliseconds")
    recorded_at: datetime = Field(
        default_factory=_utc_now,
        description="When segment was recorded",
    )
    is_accepted: bool = Field(
        default=True,
        description="Whether segment passed quality check",
    )
    rejection_reason: str | None = Field(
        default=None,
        description="Why segment was rejected (if applicable)",
    )


class RecordingSessionCreate(BaseModel):
    """Request model for creating a new recording session."""

    voicebank_id: str = Field(
        description="Target voicebank to add recordings to",
    )
    recording_style: RecordingStyle = Field(
        default=RecordingStyle.CV,
        description="Recording style: cv, vcv, cvvc, vccv, arpasing",
    )
    language: Language = Field(
        default=Language.JA,
        description="Language code (ja, en, zh, ko)",
    )
    recording_mode: Literal["individual", "paragraph"] = Field(
        default="individual",
        description="Recording mode: individual phoneme prompts or paragraph sentences",
    )
    prompts: list[str] = Field(
        min_length=1,
        description="List of text prompts to record",
    )
    paragraph_ids: list[str] | None = Field(
        default=None,
        description="Paragraph prompt IDs when using paragraph mode (for tracking)",
    )


class RecordingSessionSummary(BaseModel):
    """Lightweight summary for listing sessions."""

    id: UUID = Field(description="Unique session identifier")
    voicebank_id: str = Field(description="Associated voicebank")
    status: SessionStatus = Field(description="Current session status")
    recording_mode: Literal["individual", "paragraph"] = Field(
        default="individual",
        description="Recording mode used for this session",
    )
    total_prompts: int = Field(ge=0, description="Total prompts in session")
    completed_segments: int = Field(ge=0, description="Segments recorded so far")
    created_at: datetime = Field(description="When session was created")


class RecordingSession(BaseModel):
    """Full recording session with all details.

    Tracks progress through a set of prompts, storing recorded
    audio segments and their metadata. Supports both individual
    phoneme prompts and paragraph-based recording modes.
    """

    id: UUID = Field(default_factory=uuid4, description="Unique session identifier")
    voicebank_id: str = Field(description="Target voicebank for recordings")
    recording_style: RecordingStyle = Field(description="Recording style (cv, vcv, etc.)")
    language: Language = Field(description="Language code")
    recording_mode: Literal["individual", "paragraph"] = Field(
        default="individual",
        description="Recording mode: individual phoneme prompts or paragraph sentences",
    )
    status: SessionStatus = Field(
        default=SessionStatus.PENDING,
        description="Current session status",
    )
    prompts: list[str] = Field(description="Text prompts to record")
    paragraph_ids: list[str] | None = Field(
        default=None,
        description="Paragraph prompt IDs when using paragraph mode",
    )
    segments: list[RecordingSegment] = Field(
        default_factory=list,
        description="Recorded audio segments",
    )
    current_prompt_index: int = Field(
        default=0,
        ge=0,
        description="Index of next prompt to record",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="When session was created",
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        description="Last modification time",
    )

    model_config = {"from_attributes": True}

    @field_validator("current_prompt_index")
    @classmethod
    def validate_prompt_index(cls, v: int, info) -> int:
        """Validate current_prompt_index is within bounds when prompts exist.

        current_prompt_index points to the next prompt to record.
        When all prompts are recorded, it equals len(prompts).
        Therefore: 0 <= current_prompt_index <= len(prompts)
        """
        # Access prompts from the data being validated
        prompts = info.data.get("prompts", [])
        if prompts and v > len(prompts):
            raise ValueError(
                f"current_prompt_index ({v}) must be <= len(prompts) ({len(prompts)})"
            )
        return v

    def to_summary(self) -> RecordingSessionSummary:
        """Convert to lightweight summary."""
        return RecordingSessionSummary(
            id=self.id,
            voicebank_id=self.voicebank_id,
            status=self.status,
            recording_mode=self.recording_mode,
            total_prompts=len(self.prompts),
            completed_segments=len([s for s in self.segments if s.is_accepted]),
            created_at=self.created_at,
        )

    @property
    def progress_percent(self) -> float:
        """Calculate recording progress as percentage."""
        if not self.prompts:
            return 0.0
        accepted = len([s for s in self.segments if s.is_accepted])
        return (accepted / len(self.prompts)) * 100

    @property
    def is_complete(self) -> bool:
        """Check if all prompts have been recorded."""
        accepted = len([s for s in self.segments if s.is_accepted])
        return accepted >= len(self.prompts)


class SegmentUpload(BaseModel):
    """Request model for uploading a recorded segment."""

    prompt_index: int = Field(ge=0, description="Index of prompt that was recorded")
    prompt_text: str = Field(description="The text that was read")
    duration_ms: float = Field(ge=0, description="Audio duration in milliseconds")


class SessionProgress(BaseModel):
    """Response model for session progress status."""

    session_id: UUID = Field(description="Session identifier")
    status: SessionStatus = Field(description="Current status")
    total_prompts: int = Field(description="Total prompts to record")
    completed_segments: int = Field(description="Segments successfully recorded")
    rejected_segments: int = Field(description="Segments that failed quality check")
    progress_percent: float = Field(description="Completion percentage")
    current_prompt_index: int = Field(description="Next prompt to record")
    current_prompt_text: str | None = Field(description="Text of current prompt")
