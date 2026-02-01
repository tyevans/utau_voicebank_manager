"""Pydantic models for phoneme prompt libraries.

Prompt libraries define recording scripts for voicebank creation,
organized by language, recording style, and phoneme coverage.
"""

from typing import Literal

from pydantic import BaseModel, Field


class PhonemePrompt(BaseModel):
    """A single recording prompt with phoneme metadata.

    Each prompt represents a text string to be recorded, along with
    its phonetic breakdown for voicebank coverage analysis.
    """

    id: str = Field(
        description="Unique prompt identifier (e.g., 'ja-cv-001')",
        min_length=1,
    )
    text: str = Field(
        description="Text to display/record (native script)",
        min_length=1,
    )
    romaji: str = Field(
        description="Romanized pronunciation guide",
        min_length=1,
    )
    phonemes: list[str] = Field(
        description="Ordered list of phonemes in the prompt",
        min_length=1,
    )
    style: Literal["cv", "vcv", "cvvc", "vccv", "arpasing"] = Field(
        description="Recording style this prompt is designed for",
    )
    category: str = Field(
        description="Grouping category (e.g., 'k-row', 'voiced', 'sentences')",
    )
    difficulty: Literal["basic", "intermediate", "advanced"] = Field(
        description="Difficulty level for recording",
    )
    notes: str | None = Field(
        default=None,
        description="Optional recording tips or pronunciation notes",
    )


class CVCoverage(BaseModel):
    """Coverage tracking for CV (consonant-vowel) recording style."""

    vowels: list[str] = Field(
        description="List of covered vowel phonemes",
    )
    consonants: list[str] = Field(
        description="List of covered consonant phonemes",
    )
    special: list[str] = Field(
        default_factory=list,
        description="Special phonemes (syllabic n, geminate, etc.)",
    )


class VCVCoverage(BaseModel):
    """Coverage tracking for VCV (vowel-consonant-vowel) recording style."""

    transitions: list[str] = Field(
        description="List of V-CV transition patterns covered (e.g., 'a_ka')",
    )


class PhonemeCoverage(BaseModel):
    """Phoneme coverage metadata for a prompt library."""

    cv: CVCoverage | None = Field(
        default=None,
        description="CV style coverage details",
    )
    vcv: VCVCoverage | None = Field(
        default=None,
        description="VCV style coverage details",
    )


class PromptLibrary(BaseModel):
    """Complete prompt library for a language.

    Contains all recording prompts organized by style and category,
    along with coverage metadata for phoneme completeness verification.
    """

    language: str = Field(
        description="ISO 639-1 language code (e.g., 'ja', 'en')",
        min_length=2,
        max_length=5,
    )
    language_name: str = Field(
        description="Human-readable language name",
    )
    styles: list[str] = Field(
        description="Recording styles supported by this library",
        min_length=1,
    )
    prompts: list[PhonemePrompt] = Field(
        description="All recording prompts in the library",
        min_length=1,
    )
    coverage: PhonemeCoverage = Field(
        description="Phoneme coverage tracking",
    )

    def get_prompts_by_style(self, style: str) -> list[PhonemePrompt]:
        """Filter prompts by recording style."""
        return [p for p in self.prompts if p.style == style]

    def get_prompts_by_category(self, category: str) -> list[PhonemePrompt]:
        """Filter prompts by category."""
        return [p for p in self.prompts if p.category == category]

    def get_prompts_by_difficulty(
        self, difficulty: Literal["basic", "intermediate", "advanced"]
    ) -> list[PhonemePrompt]:
        """Filter prompts by difficulty level."""
        return [p for p in self.prompts if p.difficulty == difficulty]

    @property
    def total_prompts(self) -> int:
        """Total number of prompts in the library."""
        return len(self.prompts)

    @property
    def categories(self) -> list[str]:
        """List of unique categories in the library."""
        return sorted({p.category for p in self.prompts})
