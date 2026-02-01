"""Integration tests for paragraph-based recording flow.

Tests the complete paragraph recording system including:
- Paragraph library service (listing, retrieval, minimal sets)
- Paragraph session creation and progress tracking
- API endpoints for paragraph operations
- End-to-end flow from session creation to segmentation
"""

import tempfile
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from src.backend.domain.paragraph_prompt import (
    ParagraphLibrary,
    ParagraphPrompt,
    ParagraphRecordingProgress,
    Word,
)
from src.backend.domain.recording_session import (
    RecordingSession,
    RecordingSessionCreate,
    RecordingSegment,
    SegmentUpload,
    SessionStatus,
)
from src.backend.main import app
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.paragraph_library_service import (
    ParagraphLibraryNotFoundError,
    ParagraphLibraryService,
    ParagraphLibrarySummary,
    get_paragraph_library_service,
)
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionValidationError,
)


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def paragraph_library_service() -> ParagraphLibraryService:
    """Get the paragraph library service singleton."""
    return get_paragraph_library_service()


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def voicebank_repo(temp_dir: Path) -> VoicebankRepository:
    """Create a voicebank repository."""
    repo = VoicebankRepository(temp_dir / "voicebanks")
    return repo


@pytest.fixture
def session_repo(temp_dir: Path) -> RecordingSessionRepository:
    """Create a session repository."""
    return RecordingSessionRepository(temp_dir / "sessions")


@pytest.fixture
def session_service(
    session_repo: RecordingSessionRepository,
    voicebank_repo: VoicebankRepository,
) -> RecordingSessionService:
    """Create a session service instance."""
    return RecordingSessionService(session_repo, voicebank_repo)


@pytest.fixture
def test_client() -> TestClient:
    """FastAPI test client for API tests."""
    return TestClient(app)


@pytest.fixture
def sample_paragraph_library() -> ParagraphLibrary:
    """Create a minimal test paragraph library."""
    return ParagraphLibrary(
        id="test-library-v1",
        name="Test Library",
        language="ja",
        language_name="Japanese",
        style="cv",
        paragraphs=[
            ParagraphPrompt(
                id="test-para-001",
                text="Test sentence one",
                romaji="tesuto sentensu wan",
                words=[
                    Word(
                        text="Test",
                        romaji="tesuto",
                        phonemes=["te", "su", "to"],
                        start_char=0,
                    ),
                    Word(
                        text="sentence",
                        romaji="sentensu",
                        phonemes=["se", "n", "te", "n", "su"],
                        start_char=5,
                    ),
                    Word(
                        text="one",
                        romaji="wan",
                        phonemes=["wa", "n"],
                        start_char=14,
                    ),
                ],
                expected_phonemes=["te", "su", "to", "se", "n", "wa"],
                style="cv",
                language="ja",
                category="test",
            ),
            ParagraphPrompt(
                id="test-para-002",
                text="Test sentence two",
                romaji="tesuto sentensu tuu",
                words=[
                    Word(
                        text="Test",
                        romaji="tesuto",
                        phonemes=["te", "su", "to"],
                        start_char=0,
                    ),
                    Word(
                        text="sentence",
                        romaji="sentensu",
                        phonemes=["se", "n", "te", "n", "su"],
                        start_char=5,
                    ),
                    Word(
                        text="two",
                        romaji="tuu",
                        phonemes=["tu", "u"],
                        start_char=14,
                    ),
                ],
                expected_phonemes=["te", "su", "to", "se", "n", "tu", "u"],
                style="cv",
                language="ja",
                category="test",
            ),
        ],
        target_phonemes=["te", "su", "to", "se", "n", "wa", "tu", "u"],
        version="1.0",
    )


@pytest.fixture
def minimal_wav_data() -> bytes:
    """Create minimal valid WAV data for testing."""
    # Minimal WAV header for a tiny audio file
    return b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32


# =============================================================================
# Library Service Tests
# =============================================================================


class TestParagraphLibraryService:
    """Tests for ParagraphLibraryService."""

    def test_list_libraries_returns_japanese_cv(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """List libraries should return the Japanese CV library."""
        libraries = paragraph_library_service.list_libraries()

        assert len(libraries) >= 1
        assert any(lib.id == "ja-cv-paragraphs-v1" for lib in libraries)

        # Check the Japanese CV library summary
        ja_cv = next(lib for lib in libraries if lib.id == "ja-cv-paragraphs-v1")
        assert ja_cv.language == "ja"
        assert ja_cv.style == "cv"
        assert ja_cv.total_paragraphs > 0
        assert ja_cv.total_phonemes > 0
        assert ja_cv.coverage_percent > 0.0

    def test_get_library_by_id(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Get library by ID should return full library."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")

        assert library.id == "ja-cv-paragraphs-v1"
        assert library.name == "Japanese CV Paragraphs"
        assert library.language == "ja"
        assert library.style == "cv"
        assert len(library.paragraphs) > 0
        assert len(library.target_phonemes) > 0

    def test_get_library_for_language_style(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Get library for language/style combination."""
        library = paragraph_library_service.get_library_for_language_style("ja", "cv")

        assert library is not None
        assert library.language == "ja"
        assert library.style == "cv"

    def test_get_library_for_nonexistent_language_style(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Get library for nonexistent language/style returns None."""
        library = paragraph_library_service.get_library_for_language_style(
            "nonexistent", "cv"
        )
        assert library is None

    def test_get_paragraphs_minimal_vs_full(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Minimal set should have fewer paragraphs than full set."""
        minimal_paragraphs = paragraph_library_service.get_paragraphs(
            "ja", "cv", minimal=True
        )
        full_paragraphs = paragraph_library_service.get_paragraphs(
            "ja", "cv", minimal=False
        )

        assert len(minimal_paragraphs) <= len(full_paragraphs)
        assert len(minimal_paragraphs) > 0
        assert len(full_paragraphs) > 0

        # Minimal set should still cover all target phonemes
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")
        minimal_phonemes: set[str] = set()
        for para in minimal_paragraphs:
            minimal_phonemes.update(para.expected_phonemes)

        target_set = set(library.target_phonemes)
        coverage = len(minimal_phonemes & target_set) / len(target_set)
        assert coverage >= 0.95  # At least 95% coverage with minimal set

    def test_library_not_found_error(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Get nonexistent library should raise error."""
        with pytest.raises(ParagraphLibraryNotFoundError):
            paragraph_library_service.get_library("nonexistent-library")

    def test_register_custom_library(
        self,
        paragraph_library_service: ParagraphLibraryService,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Custom libraries can be registered."""
        paragraph_library_service.register_library(sample_paragraph_library)

        library = paragraph_library_service.get_library("test-library-v1")
        assert library.id == "test-library-v1"
        assert library.name == "Test Library"


# =============================================================================
# Paragraph Session Creation Tests
# =============================================================================


class TestParagraphSessionCreation:
    """Tests for creating paragraph-mode recording sessions."""

    @pytest.mark.asyncio
    async def test_create_paragraph_session_from_library(
        self,
        session_service: RecordingSessionService,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Create a paragraph session from a library."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")

        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=library,
            use_minimal_set=False,
        )

        assert session.voicebank_id == "test-voice"
        assert session.recording_mode == "paragraph"
        assert session.recording_style == library.style
        assert session.language == library.language
        assert len(session.prompts) == len(library.paragraphs)
        assert session.paragraph_ids is not None
        assert len(session.paragraph_ids) == len(library.paragraphs)

    @pytest.mark.asyncio
    async def test_create_paragraph_session_uses_minimal_set(
        self,
        session_service: RecordingSessionService,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Create a paragraph session with minimal set enabled."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")
        minimal_set = library.get_minimal_set()

        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=library,
            use_minimal_set=True,
        )

        assert session.recording_mode == "paragraph"
        assert len(session.prompts) == len(minimal_set)
        assert len(session.prompts) <= len(library.paragraphs)

    @pytest.mark.asyncio
    async def test_paragraph_session_has_correct_mode(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Paragraph sessions should have recording_mode='paragraph'."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        assert session.recording_mode == "paragraph"

    @pytest.mark.asyncio
    async def test_paragraph_session_stores_paragraph_ids(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Paragraph sessions should store paragraph IDs for tracking."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        assert session.paragraph_ids is not None
        assert len(session.paragraph_ids) == len(sample_paragraph_library.paragraphs)
        assert session.paragraph_ids[0] == "test-para-001"
        assert session.paragraph_ids[1] == "test-para-002"

    @pytest.mark.asyncio
    async def test_create_paragraph_session_via_create_method(
        self,
        session_service: RecordingSessionService,
    ) -> None:
        """Create paragraph session using the generic create method."""
        request = RecordingSessionCreate(
            voicebank_id="test-voice",
            recording_style="cv",
            language="ja",
            recording_mode="paragraph",
            prompts=["Sentence one", "Sentence two"],
            paragraph_ids=["para-001", "para-002"],
        )

        session = await session_service.create(request)

        assert session.recording_mode == "paragraph"
        assert session.paragraph_ids == ["para-001", "para-002"]

    @pytest.mark.asyncio
    async def test_paragraph_session_requires_paragraph_ids(
        self,
        session_service: RecordingSessionService,
    ) -> None:
        """Paragraph mode requires paragraph_ids."""
        request = RecordingSessionCreate(
            voicebank_id="test-voice",
            recording_style="cv",
            language="ja",
            recording_mode="paragraph",
            prompts=["Sentence one"],
            paragraph_ids=None,  # Missing paragraph_ids
        )

        with pytest.raises(SessionValidationError, match="paragraph_ids required"):
            await session_service.create(request)

    @pytest.mark.asyncio
    async def test_paragraph_session_ids_must_match_prompts(
        self,
        session_service: RecordingSessionService,
    ) -> None:
        """Paragraph IDs count must match prompts count."""
        request = RecordingSessionCreate(
            voicebank_id="test-voice",
            recording_style="cv",
            language="ja",
            recording_mode="paragraph",
            prompts=["Sentence one", "Sentence two"],
            paragraph_ids=["para-001"],  # Mismatched count
        )

        with pytest.raises(SessionValidationError, match="must match"):
            await session_service.create(request)


# =============================================================================
# Paragraph Progress Tests
# =============================================================================


class TestParagraphProgress:
    """Tests for paragraph recording progress tracking."""

    @pytest.mark.asyncio
    async def test_get_paragraph_progress_initial_state(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Initial paragraph progress should show 0% coverage."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        progress = await session_service.get_paragraph_progress(
            session_id=session.id,
            paragraph_library=sample_paragraph_library,
        )

        assert progress.total_paragraphs == 2
        assert progress.completed_paragraphs == 0
        assert progress.paragraph_progress_percent == 0.0
        assert progress.phoneme_coverage_percent == 0.0
        assert len(progress.recorded_phonemes) == 0
        assert len(progress.remaining_phonemes) == len(
            sample_paragraph_library.target_phonemes
        )

    @pytest.mark.asyncio
    async def test_paragraph_progress_after_recording(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
        minimal_wav_data: bytes,
    ) -> None:
        """Progress should update after recording a paragraph."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        # Upload a segment for the first paragraph
        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text=sample_paragraph_library.paragraphs[0].text,
            duration_ms=2500.0,  # Paragraph recordings need longer duration
        )
        await session_service.upload_segment(
            session.id, segment_info, minimal_wav_data
        )

        progress = await session_service.get_paragraph_progress(
            session_id=session.id,
            paragraph_library=sample_paragraph_library,
        )

        assert progress.completed_paragraphs == 1
        assert progress.paragraph_progress_percent == 50.0  # 1/2 paragraphs
        assert progress.phoneme_coverage_percent > 0.0

    @pytest.mark.asyncio
    async def test_paragraph_progress_phoneme_coverage(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
        minimal_wav_data: bytes,
    ) -> None:
        """Phoneme coverage should track which phonemes are recorded."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        # Record first paragraph
        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text=sample_paragraph_library.paragraphs[0].text,
            duration_ms=2500.0,
        )
        await session_service.upload_segment(
            session.id, segment_info, minimal_wav_data
        )

        progress = await session_service.get_paragraph_progress(
            session_id=session.id,
            paragraph_library=sample_paragraph_library,
        )

        # First paragraph covers: te, su, to, se, n, wa
        first_para_phonemes = set(
            sample_paragraph_library.paragraphs[0].expected_phonemes
        )
        recorded = set(progress.recorded_phonemes)

        assert first_para_phonemes <= recorded

    @pytest.mark.asyncio
    async def test_paragraph_progress_without_library(
        self,
        session_service: RecordingSessionService,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Progress without library should have empty phoneme tracking."""
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=sample_paragraph_library,
        )

        progress = await session_service.get_paragraph_progress(
            session_id=session.id,
            paragraph_library=None,  # No library provided
        )

        assert progress.total_paragraphs == 2
        assert progress.completed_paragraphs == 0
        assert len(progress.target_phonemes) == 0
        assert len(progress.recorded_phonemes) == 0

    @pytest.mark.asyncio
    async def test_paragraph_progress_individual_mode_fails(
        self,
        session_service: RecordingSessionService,
    ) -> None:
        """Getting paragraph progress for individual mode should fail."""
        # Create individual mode session
        request = RecordingSessionCreate(
            voicebank_id="test-voice",
            recording_style="cv",
            language="ja",
            recording_mode="individual",
            prompts=["ka", "sa"],
        )
        session = await session_service.create(request)

        with pytest.raises(SessionValidationError, match="not in paragraph mode"):
            await session_service.get_paragraph_progress(session.id)


# =============================================================================
# API Endpoint Tests
# =============================================================================


class TestParagraphAPIEndpoints:
    """Tests for paragraph-related API endpoints."""

    def test_api_list_paragraph_libraries(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /paragraphs/libraries should return library list."""
        response = test_client.get("/api/v1/paragraphs/libraries")

        assert response.status_code == 200
        libraries = response.json()
        assert isinstance(libraries, list)
        assert len(libraries) >= 1

        # Verify structure
        ja_cv = next(
            (lib for lib in libraries if lib["id"] == "ja-cv-paragraphs-v1"), None
        )
        assert ja_cv is not None
        assert ja_cv["language"] == "ja"
        assert ja_cv["style"] == "cv"
        assert "total_paragraphs" in ja_cv
        assert "total_phonemes" in ja_cv
        assert "coverage_percent" in ja_cv

    def test_api_get_paragraph_library(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /paragraphs/libraries/{id} should return full library."""
        response = test_client.get("/api/v1/paragraphs/libraries/ja-cv-paragraphs-v1")

        assert response.status_code == 200
        library = response.json()
        assert library["id"] == "ja-cv-paragraphs-v1"
        assert library["name"] == "Japanese CV Paragraphs"
        assert "paragraphs" in library
        assert len(library["paragraphs"]) > 0

        # Verify paragraph structure
        para = library["paragraphs"][0]
        assert "id" in para
        assert "text" in para
        assert "romaji" in para
        assert "words" in para
        assert "expected_phonemes" in para

    def test_api_get_paragraph_library_not_found(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /paragraphs/libraries/{id} returns 404 for unknown library."""
        response = test_client.get("/api/v1/paragraphs/libraries/nonexistent")

        assert response.status_code == 404

    def test_api_get_paragraphs_by_language_style(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /paragraphs/{language}/{style} should return paragraphs."""
        response = test_client.get("/api/v1/paragraphs/ja/cv")

        assert response.status_code == 200
        paragraphs = response.json()
        assert isinstance(paragraphs, list)
        assert len(paragraphs) > 0

        # All paragraphs should be for ja/cv
        for para in paragraphs:
            assert para["language"] == "ja"
            assert para["style"] == "cv"

    def test_api_get_paragraphs_minimal_vs_full(
        self,
        test_client: TestClient,
    ) -> None:
        """Minimal=true should return fewer paragraphs."""
        minimal_response = test_client.get("/api/v1/paragraphs/ja/cv?minimal=true")
        full_response = test_client.get("/api/v1/paragraphs/ja/cv?minimal=false")

        assert minimal_response.status_code == 200
        assert full_response.status_code == 200

        minimal_paragraphs = minimal_response.json()
        full_paragraphs = full_response.json()

        assert len(minimal_paragraphs) <= len(full_paragraphs)

    def test_api_get_paragraphs_not_found(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /paragraphs/{language}/{style} returns 404 for unknown combo."""
        response = test_client.get("/api/v1/paragraphs/xx/unknown")

        assert response.status_code == 404

    def test_api_create_paragraph_session(
        self,
        test_client: TestClient,
    ) -> None:
        """POST /sessions/paragraph should create paragraph session."""
        response = test_client.post(
            "/api/v1/sessions/paragraph",
            data={
                "voicebank_id": "test-voicebank",
                "library_id": "ja-cv-paragraphs-v1",
                "use_minimal_set": "true",
            },
        )

        assert response.status_code == 201
        session = response.json()
        assert session["voicebank_id"] == "test-voicebank"
        assert session["recording_mode"] == "paragraph"
        assert session["language"] == "ja"
        assert session["recording_style"] == "cv"
        assert "paragraph_ids" in session
        assert len(session["paragraph_ids"]) > 0

    def test_api_create_paragraph_session_invalid_library(
        self,
        test_client: TestClient,
    ) -> None:
        """POST /sessions/paragraph with invalid library returns 404."""
        response = test_client.post(
            "/api/v1/sessions/paragraph",
            data={
                "voicebank_id": "test-voicebank",
                "library_id": "nonexistent-library",
                "use_minimal_set": "true",
            },
        )

        assert response.status_code == 404

    def test_api_get_paragraph_progress(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /sessions/{id}/paragraph-progress should return progress."""
        # First create a paragraph session
        create_response = test_client.post(
            "/api/v1/sessions/paragraph",
            data={
                "voicebank_id": "test-voicebank",
                "library_id": "ja-cv-paragraphs-v1",
                "use_minimal_set": "true",
            },
        )
        assert create_response.status_code == 201
        session = create_response.json()
        session_id = session["id"]

        # Get paragraph progress
        progress_response = test_client.get(
            f"/api/v1/sessions/{session_id}/paragraph-progress",
            params={"library_id": "ja-cv-paragraphs-v1"},
        )

        assert progress_response.status_code == 200
        progress = progress_response.json()
        assert "total_paragraphs" in progress
        assert "completed_paragraphs" in progress
        assert "paragraph_progress_percent" in progress
        assert "phoneme_coverage_percent" in progress
        assert "target_phonemes" in progress
        assert "recorded_phonemes" in progress
        assert "remaining_phonemes" in progress

    def test_api_get_paragraph_progress_without_library(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /sessions/{id}/paragraph-progress works without library_id."""
        # First create a paragraph session
        create_response = test_client.post(
            "/api/v1/sessions/paragraph",
            data={
                "voicebank_id": "test-voicebank",
                "library_id": "ja-cv-paragraphs-v1",
                "use_minimal_set": "true",
            },
        )
        assert create_response.status_code == 201
        session = create_response.json()
        session_id = session["id"]

        # Get paragraph progress without library_id
        progress_response = test_client.get(
            f"/api/v1/sessions/{session_id}/paragraph-progress"
        )

        assert progress_response.status_code == 200
        progress = progress_response.json()
        assert progress["target_phonemes"] == []  # No library = no phoneme tracking

    def test_api_get_paragraph_progress_individual_session_fails(
        self,
        test_client: TestClient,
    ) -> None:
        """GET /sessions/{id}/paragraph-progress fails for individual sessions."""
        # Create an individual mode session
        create_response = test_client.post(
            "/api/v1/sessions",
            json={
                "voicebank_id": "test-voicebank",
                "recording_style": "cv",
                "language": "ja",
                "recording_mode": "individual",
                "prompts": ["ka", "sa"],
            },
        )
        assert create_response.status_code == 201
        session = create_response.json()
        session_id = session["id"]

        # Try to get paragraph progress
        progress_response = test_client.get(
            f"/api/v1/sessions/{session_id}/paragraph-progress"
        )

        assert progress_response.status_code == 400


# =============================================================================
# End-to-End Flow Tests
# =============================================================================


class TestEndToEndParagraphFlow:
    """End-to-end tests for the complete paragraph recording flow."""

    @pytest.mark.asyncio
    async def test_complete_paragraph_recording_flow(
        self,
        session_service: RecordingSessionService,
        paragraph_library_service: ParagraphLibraryService,
        minimal_wav_data: bytes,
    ) -> None:
        """Test the complete flow from session creation to progress tracking."""
        # 1. Get paragraph library
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")
        assert library is not None

        # 2. Create paragraph session with minimal set
        session = await session_service.create_paragraph_session(
            voicebank_id="test-voice",
            paragraph_library=library,
            use_minimal_set=True,
        )

        # 3. Verify session is in paragraph mode
        assert session.recording_mode == "paragraph"
        assert session.status == SessionStatus.PENDING

        # 4. Check progress shows 0% initially
        progress = await session_service.get_paragraph_progress(session.id, library)
        assert progress.phoneme_coverage_percent == 0.0
        assert progress.completed_paragraphs == 0

        # 5. Upload first paragraph recording
        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text=session.prompts[0],
            duration_ms=2500.0,  # Paragraph recordings need longer duration
        )
        segment = await session_service.upload_segment(
            session.id, segment_info, minimal_wav_data
        )
        assert segment.is_accepted

        # 6. Verify progress updated
        progress = await session_service.get_paragraph_progress(session.id, library)
        assert progress.completed_paragraphs == 1
        assert progress.phoneme_coverage_percent > 0.0
        assert len(progress.recorded_phonemes) > 0

        # 7. Upload remaining paragraphs
        for i in range(1, len(session.prompts)):
            segment_info = SegmentUpload(
                prompt_index=i,
                prompt_text=session.prompts[i],
                duration_ms=2500.0,
            )
            await session_service.upload_segment(
                session.id, segment_info, minimal_wav_data
            )

        # 8. Verify final progress
        progress = await session_service.get_paragraph_progress(session.id, library)
        assert progress.completed_paragraphs == len(session.prompts)
        assert progress.paragraph_progress_percent == 100.0
        # Coverage should be high (may not be exactly 100% due to minimal set selection)
        assert progress.phoneme_coverage_percent >= 95.0

    def test_api_complete_paragraph_flow(
        self,
        test_client: TestClient,
    ) -> None:
        """Test complete flow through API endpoints."""
        # 1. List available libraries
        libs_response = test_client.get("/api/v1/paragraphs/libraries")
        assert libs_response.status_code == 200
        libraries = libs_response.json()
        assert len(libraries) >= 1

        # 2. Get Japanese CV library
        lib_response = test_client.get(
            "/api/v1/paragraphs/libraries/ja-cv-paragraphs-v1"
        )
        assert lib_response.status_code == 200
        library = lib_response.json()

        # 3. Create paragraph session
        session_response = test_client.post(
            "/api/v1/sessions/paragraph",
            data={
                "voicebank_id": "api-test-voicebank",
                "library_id": "ja-cv-paragraphs-v1",
                "use_minimal_set": "true",
            },
        )
        assert session_response.status_code == 201
        session = session_response.json()
        session_id = session["id"]

        # 4. Get session and verify mode
        get_response = test_client.get(f"/api/v1/sessions/{session_id}")
        assert get_response.status_code == 200
        session_data = get_response.json()
        assert session_data["recording_mode"] == "paragraph"

        # 5. Get initial progress
        progress_response = test_client.get(
            f"/api/v1/sessions/{session_id}/paragraph-progress",
            params={"library_id": "ja-cv-paragraphs-v1"},
        )
        assert progress_response.status_code == 200
        progress = progress_response.json()
        assert progress["completed_paragraphs"] == 0
        assert progress["phoneme_coverage_percent"] == 0.0

        # 6. Get standard session status
        status_response = test_client.get(f"/api/v1/sessions/{session_id}/status")
        assert status_response.status_code == 200
        status = status_response.json()
        assert status["total_prompts"] == len(session["prompts"])
        assert status["completed_segments"] == 0


# =============================================================================
# ParagraphLibrary Model Tests
# =============================================================================


class TestParagraphLibraryModel:
    """Tests for ParagraphLibrary computed fields and methods."""

    def test_library_coverage_calculation(
        self,
        sample_paragraph_library: ParagraphLibrary,
    ) -> None:
        """Library coverage should be calculated correctly."""
        # Our sample library has 8 target phonemes and paragraphs covering all
        assert sample_paragraph_library.coverage_percent == 100.0
        assert sample_paragraph_library.missing_phonemes == []

    def test_library_get_minimal_set(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """get_minimal_set should return subset covering all phonemes."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")
        minimal = library.get_minimal_set()

        # Minimal set should be smaller
        assert len(minimal) <= len(library.paragraphs)

        # But should still cover target phonemes
        covered: set[str] = set()
        for para in minimal:
            covered.update(para.expected_phonemes)

        target = set(library.target_phonemes)
        coverage = len(covered & target) / len(target) if target else 0
        assert coverage >= 0.95

    def test_library_get_paragraphs_by_category(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Filter paragraphs by category."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")

        # Check we can filter by known category
        basic_paras = library.get_paragraphs_by_category("basic-coverage")
        assert len(basic_paras) > 0
        for para in basic_paras:
            assert para.category == "basic-coverage"

    def test_library_get_paragraphs_for_phonemes(
        self,
        paragraph_library_service: ParagraphLibraryService,
    ) -> None:
        """Get paragraphs containing specific phonemes."""
        library = paragraph_library_service.get_library("ja-cv-paragraphs-v1")

        # Find paragraphs with 'ka' phoneme
        ka_paras = library.get_paragraphs_for_phonemes(["ka"])
        assert len(ka_paras) > 0
        for para in ka_paras:
            assert "ka" in para.expected_phonemes


# =============================================================================
# ParagraphRecordingProgress Model Tests
# =============================================================================


class TestParagraphRecordingProgressModel:
    """Tests for ParagraphRecordingProgress computed fields."""

    def test_progress_empty_state(self) -> None:
        """Empty progress should show 0%."""
        progress = ParagraphRecordingProgress(
            total_paragraphs=10,
            completed_paragraphs=0,
            target_phonemes=["a", "i", "u", "e", "o"],
            recorded_phonemes=[],
        )

        assert progress.paragraph_progress_percent == 0.0
        assert progress.phoneme_coverage_percent == 0.0
        assert progress.remaining_phonemes == ["a", "e", "i", "o", "u"]

    def test_progress_partial_state(self) -> None:
        """Partial progress should calculate correctly."""
        progress = ParagraphRecordingProgress(
            total_paragraphs=10,
            completed_paragraphs=3,
            target_phonemes=["a", "i", "u", "e", "o"],
            recorded_phonemes=["a", "i"],
        )

        assert progress.paragraph_progress_percent == 30.0
        assert progress.phoneme_coverage_percent == 40.0
        assert set(progress.remaining_phonemes) == {"u", "e", "o"}

    def test_progress_complete_state(self) -> None:
        """Complete progress should show 100%."""
        progress = ParagraphRecordingProgress(
            total_paragraphs=5,
            completed_paragraphs=5,
            target_phonemes=["a", "i", "u"],
            recorded_phonemes=["a", "i", "u"],
        )

        assert progress.paragraph_progress_percent == 100.0
        assert progress.phoneme_coverage_percent == 100.0
        assert progress.remaining_phonemes == []

    def test_progress_no_target_phonemes(self) -> None:
        """Progress with no target should handle edge case."""
        progress = ParagraphRecordingProgress(
            total_paragraphs=5,
            completed_paragraphs=2,
            target_phonemes=[],
            recorded_phonemes=[],
        )

        assert progress.paragraph_progress_percent == 40.0
        assert progress.phoneme_coverage_percent == 0.0

    def test_progress_no_paragraphs(self) -> None:
        """Progress with no paragraphs should handle edge case."""
        progress = ParagraphRecordingProgress(
            total_paragraphs=0,
            completed_paragraphs=0,
            target_phonemes=["a"],
            recorded_phonemes=[],
        )

        assert progress.paragraph_progress_percent == 0.0
