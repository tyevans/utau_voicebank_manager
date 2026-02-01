"""Service layer for paragraph library management.

Provides access to paragraph prompt libraries for efficient voicebank recording.
Libraries contain natural sentences designed to cover all phonemes for a given
language and style with minimal recording overhead.
"""

from typing import Literal

from pydantic import BaseModel, Field

from src.backend.domain.paragraph_prompt import ParagraphLibrary, ParagraphPrompt


class ParagraphLibrarySummary(BaseModel):
    """Lightweight summary of a paragraph library.

    Used for listing available libraries without loading full paragraph data.
    """

    id: str = Field(
        description="Library identifier (e.g., 'ja-cv-paragraphs-v1')",
    )
    name: str = Field(
        description="Human-readable library name",
    )
    language: str = Field(
        description="ISO 639-1 language code (e.g., 'ja', 'en')",
    )
    style: Literal["cv", "vcv", "cvvc", "vccv", "arpasing"] = Field(
        description="Recording style covered by this library",
    )
    total_paragraphs: int = Field(
        ge=0,
        description="Total number of paragraphs in the library",
    )
    total_phonemes: int = Field(
        ge=0,
        description="Total unique phonemes covered by the library",
    )
    coverage_percent: float = Field(
        ge=0.0,
        le=100.0,
        description="Percentage of target phonemes covered",
    )


class ParagraphLibraryNotFoundError(Exception):
    """Raised when a paragraph library is not found."""


class ParagraphLibraryService:
    """Service for managing paragraph prompt libraries.

    Provides access to pre-defined paragraph libraries for different
    languages and recording styles. Libraries are registered at startup
    and can be queried by ID or language/style combination.
    """

    def __init__(self) -> None:
        """Initialize service and register default libraries."""
        self._libraries: dict[str, ParagraphLibrary] = {}
        self._register_default_libraries()

    def _register_default_libraries(self) -> None:
        """Register built-in paragraph libraries.

        Called during initialization to populate available libraries.
        """
        # Import Japanese CV paragraphs
        from src.backend.data.japanese_cv_paragraphs import (
            get_japanese_cv_paragraph_library,
        )

        ja_cv_library = get_japanese_cv_paragraph_library()
        self._libraries[ja_cv_library.id] = ja_cv_library

    def register_library(self, library: ParagraphLibrary) -> None:
        """Register a paragraph library.

        Args:
            library: Library to register
        """
        self._libraries[library.id] = library

    def list_libraries(self) -> list[ParagraphLibrarySummary]:
        """List all available paragraph libraries.

        Returns:
            List of library summaries sorted by name
        """
        summaries = []
        for library in self._libraries.values():
            summaries.append(
                ParagraphLibrarySummary(
                    id=library.id,
                    name=library.name,
                    language=library.language,
                    style=library.style,
                    total_paragraphs=library.total_paragraphs,
                    total_phonemes=len(library.covered_phonemes),
                    coverage_percent=library.coverage_percent,
                )
            )
        return sorted(summaries, key=lambda s: s.name)

    def get_library(self, library_id: str) -> ParagraphLibrary:
        """Get a paragraph library by ID.

        Args:
            library_id: Library identifier

        Returns:
            Full paragraph library with all prompts

        Raises:
            ParagraphLibraryNotFoundError: If library not found
        """
        library = self._libraries.get(library_id)
        if library is None:
            available = ", ".join(self._libraries.keys())
            raise ParagraphLibraryNotFoundError(
                f"Library '{library_id}' not found. Available: {available}"
            )
        return library

    def get_library_for_language_style(
        self,
        language: str,
        style: str,
    ) -> ParagraphLibrary | None:
        """Find a library matching language and style.

        Args:
            language: ISO 639-1 language code (e.g., 'ja')
            style: Recording style (e.g., 'cv', 'vcv')

        Returns:
            Matching library or None if not found
        """
        for library in self._libraries.values():
            if library.language == language and library.style == style:
                return library
        return None

    def get_paragraphs(
        self,
        language: str,
        style: str,
        minimal: bool = True,
    ) -> list[ParagraphPrompt]:
        """Get paragraphs for a language/style combination.

        Args:
            language: ISO 639-1 language code
            style: Recording style
            minimal: If True, return only minimal set for full coverage

        Returns:
            List of paragraph prompts

        Raises:
            ParagraphLibraryNotFoundError: If no matching library found
        """
        library = self.get_library_for_language_style(language, style)
        if library is None:
            raise ParagraphLibraryNotFoundError(
                f"No library found for language='{language}', style='{style}'"
            )

        if minimal:
            return library.get_minimal_set()
        return library.paragraphs


# Module-level singleton
_paragraph_library_service: ParagraphLibraryService | None = None


def get_paragraph_library_service() -> ParagraphLibraryService:
    """Get the paragraph library service singleton.

    Returns:
        ParagraphLibraryService instance
    """
    global _paragraph_library_service

    if _paragraph_library_service is None:
        _paragraph_library_service = ParagraphLibraryService()

    return _paragraph_library_service
