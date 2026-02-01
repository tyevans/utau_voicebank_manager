"""Pydantic models for paragraph-based recording prompts.

Paragraph prompts enable efficient voicebank recording by using natural
sentences that cover multiple phonemes, rather than individual mora prompts.
This reduces recording time from 111+ individual prompts to ~15 sentences
while maintaining complete phoneme coverage.
"""

from typing import Literal

from pydantic import BaseModel, Field, computed_field


class Word(BaseModel):
    """A word within a paragraph prompt with phoneme breakdown.

    Represents a single word in a sentence, including its position
    and the phonemes it contains for coverage tracking.
    """

    text: str = Field(
        description="Word in native script (e.g., '赤い')",
        min_length=1,
    )
    romaji: str = Field(
        description="Romanized pronunciation (e.g., 'akai')",
        min_length=1,
    )
    phonemes: list[str] = Field(
        description="Ordered phonemes in this word (e.g., ['a', 'ka', 'i'])",
        min_length=1,
    )
    start_char: int = Field(
        ge=0,
        description="Character position where word starts in sentence",
    )

    @computed_field
    @property
    def end_char(self) -> int:
        """Character position where word ends (exclusive)."""
        return self.start_char + len(self.text)


class ParagraphPrompt(BaseModel):
    """A sentence-based recording prompt covering multiple phonemes.

    Paragraph prompts contain natural sentences that cover multiple CV/VCV
    phonemes efficiently. Users record the full sentence, and ML models
    segment it into individual phoneme samples.
    """

    id: str = Field(
        description="Unique prompt identifier (e.g., 'ja-cv-para-001')",
        min_length=1,
    )
    text: str = Field(
        description="Full sentence in native script (e.g., '赤い花が咲く')",
        min_length=1,
    )
    romaji: str = Field(
        description="Romanized version with word boundaries (e.g., 'akai hana ga saku')",
        min_length=1,
    )
    words: list[Word] = Field(
        description="Word-by-word breakdown with phoneme mappings",
        min_length=1,
    )
    expected_phonemes: list[str] = Field(
        description="Complete list of unique phonemes this sentence covers",
        min_length=1,
    )
    style: Literal["cv", "vcv", "cvvc", "vccv", "arpasing"] = Field(
        description="Recording style this prompt is designed for",
    )
    language: str = Field(
        description="ISO 639-1 language code (e.g., 'ja', 'en')",
        min_length=2,
        max_length=5,
    )
    category: str = Field(
        description="Grouping category (e.g., 'basic-coverage', 'advanced-sounds')",
    )
    difficulty: Literal["basic", "intermediate", "advanced"] = Field(
        default="basic",
        description="Recording difficulty level",
    )
    notes: str | None = Field(
        default=None,
        description="Optional recording tips or pronunciation guidance",
    )

    @computed_field
    @property
    def phoneme_count(self) -> int:
        """Number of unique phonemes covered by this sentence."""
        return len(set(self.expected_phonemes))

    @computed_field
    @property
    def word_count(self) -> int:
        """Number of words in this sentence."""
        return len(self.words)


class ParagraphLibrary(BaseModel):
    """Collection of paragraph prompts for efficient voicebank recording.

    A paragraph library contains sentences designed to cover all phonemes
    for a given language and style with minimal recording overhead.
    """

    id: str = Field(
        description="Library identifier (e.g., 'ja-cv-paragraphs-v1')",
        min_length=1,
    )
    name: str = Field(
        description="Human-readable library name",
        min_length=1,
    )
    language: str = Field(
        description="ISO 639-1 language code",
        min_length=2,
        max_length=5,
    )
    language_name: str = Field(
        description="Human-readable language name (e.g., 'Japanese')",
    )
    style: Literal["cv", "vcv", "cvvc", "vccv", "arpasing"] = Field(
        description="Recording style covered by this library",
    )
    paragraphs: list[ParagraphPrompt] = Field(
        description="All paragraph prompts in the library",
        min_length=1,
    )
    target_phonemes: list[str] = Field(
        description="Complete list of phonemes this library aims to cover",
    )
    version: str = Field(
        default="1.0",
        description="Library version for tracking updates",
    )
    notes: str | None = Field(
        default=None,
        description="General notes about this library",
    )

    @computed_field
    @property
    def total_paragraphs(self) -> int:
        """Total number of paragraphs in the library."""
        return len(self.paragraphs)

    @computed_field
    @property
    def covered_phonemes(self) -> list[str]:
        """All unique phonemes covered by paragraphs in this library."""
        all_phonemes: set[str] = set()
        for para in self.paragraphs:
            all_phonemes.update(para.expected_phonemes)
        return sorted(all_phonemes)

    @computed_field
    @property
    def coverage_percent(self) -> float:
        """Percentage of target phonemes covered by this library."""
        if not self.target_phonemes:
            return 0.0
        covered = set(self.covered_phonemes)
        target = set(self.target_phonemes)
        return (len(covered & target) / len(target)) * 100

    @computed_field
    @property
    def missing_phonemes(self) -> list[str]:
        """Phonemes in target list not covered by any paragraph."""
        covered = set(self.covered_phonemes)
        target = set(self.target_phonemes)
        return sorted(target - covered)

    def get_paragraphs_by_category(self, category: str) -> list[ParagraphPrompt]:
        """Filter paragraphs by category."""
        return [p for p in self.paragraphs if p.category == category]

    def get_paragraphs_by_difficulty(
        self, difficulty: Literal["basic", "intermediate", "advanced"]
    ) -> list[ParagraphPrompt]:
        """Filter paragraphs by difficulty level."""
        return [p for p in self.paragraphs if p.difficulty == difficulty]

    def get_minimal_set(self) -> list[ParagraphPrompt]:
        """Return the fewest paragraphs needed for full phoneme coverage.

        Uses a greedy set-cover algorithm to find a minimal subset of
        paragraphs that covers all target phonemes.
        """
        target = set(self.target_phonemes)
        covered: set[str] = set()
        selected: list[ParagraphPrompt] = []
        remaining = list(self.paragraphs)

        while covered < target and remaining:
            # Find paragraph that covers the most uncovered phonemes
            best_para = max(
                remaining,
                key=lambda p: len(set(p.expected_phonemes) - covered),
            )
            new_coverage = set(best_para.expected_phonemes) - covered
            if not new_coverage:
                break
            selected.append(best_para)
            covered.update(new_coverage)
            remaining.remove(best_para)

        return selected

    def get_paragraphs_for_phonemes(self, phonemes: list[str]) -> list[ParagraphPrompt]:
        """Get paragraphs that contain any of the specified phonemes."""
        phoneme_set = set(phonemes)
        return [p for p in self.paragraphs if phoneme_set & set(p.expected_phonemes)]


class ParagraphRecordingProgress(BaseModel):
    """Tracks recording progress for paragraph-based sessions.

    Provides coverage statistics and identifies which phonemes
    still need to be recorded.
    """

    total_paragraphs: int = Field(
        ge=0,
        description="Total paragraphs in the session",
    )
    completed_paragraphs: int = Field(
        ge=0,
        description="Paragraphs successfully recorded",
    )
    target_phonemes: list[str] = Field(
        description="All phonemes that should be covered",
    )
    recorded_phonemes: list[str] = Field(
        default_factory=list,
        description="Phonemes covered by completed recordings",
    )

    @computed_field
    @property
    def paragraph_progress_percent(self) -> float:
        """Percentage of paragraphs completed."""
        if self.total_paragraphs == 0:
            return 0.0
        return (self.completed_paragraphs / self.total_paragraphs) * 100

    @computed_field
    @property
    def phoneme_coverage_percent(self) -> float:
        """Percentage of target phonemes covered."""
        if not self.target_phonemes:
            return 0.0
        covered = set(self.recorded_phonemes)
        target = set(self.target_phonemes)
        return (len(covered & target) / len(target)) * 100

    @computed_field
    @property
    def remaining_phonemes(self) -> list[str]:
        """Phonemes not yet covered by recordings."""
        covered = set(self.recorded_phonemes)
        target = set(self.target_phonemes)
        return sorted(target - covered)
