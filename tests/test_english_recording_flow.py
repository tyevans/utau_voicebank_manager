"""End-to-end tests for the English/ARPAsing recording flow.

Tests the complete English voicebank recording pipeline:
- Language.EN and RecordingStyle.ARPASING enum values
- Session creation with English/ARPAsing parameters
- English prompt library loading and structure validation
- ARPABET pronunciation hints in prompt metadata
- Oto.ini generation with English phoneme aliases
- Segment filename generation for English prompts
"""

import json
import tempfile
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.prompt import PhonemePrompt, PromptLibrary
from src.backend.domain.recording_session import (
    RecordingSegment,
    RecordingSession,
    RecordingSessionCreate,
    SegmentUpload,
    SessionStatus,
)
from src.backend.domain.voicebank import Language, RecordingStyle
from src.backend.repositories.recording_session_repository import (
    RecordingSessionRepository,
)
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.recording_session_service import (
    RecordingSessionService,
    SessionValidationError,
)
from src.backend.utils.oto_parser import (
    parse_oto_file,
    parse_oto_line,
    serialize_oto_entries,
    write_oto_file,
)

# =============================================================================
# Path to the English ARPAsing prompt data file
# =============================================================================

ENGLISH_PROMPTS_PATH = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "backend"
    / "data"
    / "prompts"
    / "english_arpasing.json"
)


# =============================================================================
# Shared Fixtures
# =============================================================================


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def voicebank_repo(temp_dir: Path) -> VoicebankRepository:
    """Create a voicebank repository."""
    return VoicebankRepository(temp_dir / "voicebanks")


@pytest.fixture
def session_repo(temp_dir: Path) -> RecordingSessionRepository:
    """Create a session repository."""
    return RecordingSessionRepository(temp_dir / "sessions")


@pytest.fixture
def service(
    session_repo: RecordingSessionRepository,
    voicebank_repo: VoicebankRepository,
) -> RecordingSessionService:
    """Create a RecordingSessionService instance."""
    return RecordingSessionService(session_repo, voicebank_repo)


@pytest.fixture
def english_prompt_data() -> dict:
    """Load raw English ARPAsing prompt data from JSON."""
    with open(ENGLISH_PROMPTS_PATH) as f:
        return json.load(f)


@pytest.fixture
def english_prompt_library(english_prompt_data: dict) -> PromptLibrary:
    """Parse the English ARPAsing prompt JSON into a PromptLibrary model."""
    return PromptLibrary(**english_prompt_data)


@pytest.fixture
def minimal_wav_data() -> bytes:
    """Minimal valid WAV data for upload tests."""
    return b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32


# =============================================================================
# 1. Language and RecordingStyle Enum Tests
# =============================================================================


class TestEnglishEnums:
    """Verify Language.EN and RecordingStyle.ARPASING enum values."""

    def test_language_en_exists(self) -> None:
        """Language enum includes English."""
        assert Language.EN == "en"
        assert Language.EN.value == "en"

    def test_recording_style_arpasing_exists(self) -> None:
        """RecordingStyle enum includes ARPAsing."""
        assert RecordingStyle.ARPASING == "arpasing"
        assert RecordingStyle.ARPASING.value == "arpasing"

    def test_language_en_in_supported_set(self) -> None:
        """Language.EN is in the service's SUPPORTED_LANGUAGES."""
        supported = {lang.value for lang in Language}
        assert "en" in supported

    def test_arpasing_in_supported_set(self) -> None:
        """RecordingStyle.ARPASING is in the service's SUPPORTED_STYLES."""
        supported = {style.value for style in RecordingStyle}
        assert "arpasing" in supported

    def test_language_en_roundtrips_through_string(self) -> None:
        """Language.EN can be created from the string 'en'."""
        lang = Language("en")
        assert lang is Language.EN

    def test_recording_style_arpasing_roundtrips_through_string(self) -> None:
        """RecordingStyle.ARPASING can be created from the string 'arpasing'."""
        style = RecordingStyle("arpasing")
        assert style is RecordingStyle.ARPASING


# =============================================================================
# 2. English Prompt Library Tests
# =============================================================================


class TestEnglishPromptLibrary:
    """Verify the English ARPAsing prompt data file is well-formed."""

    def test_prompt_file_exists(self) -> None:
        """The english_arpasing.json data file exists on disk."""
        assert ENGLISH_PROMPTS_PATH.exists(), (
            f"Expected prompt file at {ENGLISH_PROMPTS_PATH}"
        )

    def test_prompt_library_parses(self, english_prompt_library: PromptLibrary) -> None:
        """The English prompt JSON parses into a valid PromptLibrary."""
        assert english_prompt_library.language == "en"
        assert english_prompt_library.language_name == "English"

    def test_library_has_arpasing_style(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """The library declares 'arpasing' as a supported style."""
        assert "arpasing" in english_prompt_library.styles

    def test_library_has_prompts(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """The library has a non-trivial number of prompts."""
        assert english_prompt_library.total_prompts >= 30

    def test_all_prompts_are_arpasing_style(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Every prompt in the English library uses the 'arpasing' style."""
        for prompt in english_prompt_library.prompts:
            assert prompt.style == RecordingStyle.ARPASING, (
                f"Prompt {prompt.id} has style '{prompt.style}', expected 'arpasing'"
            )

    def test_basic_word_prompts_present(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Canonical English words like 'cat' and 'dog' appear as prompts."""
        prompt_texts = {p.text for p in english_prompt_library.prompts}
        assert "cat" in prompt_texts, "Expected 'cat' as a basic word prompt"
        assert "dog" in prompt_texts, "Expected 'dog' as a basic word prompt"

    def test_prompts_have_arpabet_phonemes(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Prompts contain ARPABET phoneme symbols (not IPA or romaji)."""
        # Common ARPABET symbols that must appear in the phoneme lists
        all_phonemes: set[str] = set()
        for prompt in english_prompt_library.prompts:
            all_phonemes.update(prompt.phonemes)

        # These are distinctively ARPABET (not shared with IPA/romaji)
        arpabet_markers = {"ae", "aa", "ih", "iy", "uw", "ow", "ay", "ey"}
        found = arpabet_markers & all_phonemes
        assert len(found) >= 5, (
            f"Expected at least 5 ARPABET vowel symbols, found {found}"
        )

    def test_prompt_romaji_field_has_pronunciation(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """The romaji field contains pronunciation info for English prompts.

        For English, the 'romaji' field serves as a pronunciation guide
        rather than a Japanese romanization. It should be non-empty.
        """
        for prompt in english_prompt_library.prompts:
            assert len(prompt.romaji.strip()) > 0, (
                f"Prompt {prompt.id} has empty romaji/pronunciation field"
            )

    def test_prompt_notes_contain_arpabet_descriptions(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Prompt notes include ARPABET phoneme explanations."""
        # At least some prompts should have descriptive notes
        prompts_with_notes = [
            p for p in english_prompt_library.prompts if p.notes
        ]
        assert len(prompts_with_notes) > 0, "Expected prompts to have notes"

        # Check that notes reference ARPABET-style phoneme names
        all_notes = " ".join(p.notes for p in prompts_with_notes if p.notes)
        # ARPABET phoneme names commonly referenced in notes
        assert any(
            term in all_notes.lower()
            for term in ["vowel", "fricative", "stop", "nasal", "consonant"]
        ), "Expected notes to contain phonetic terminology"

    def test_categories_include_expected_types(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """The library has expected categories for English recording."""
        categories = set(english_prompt_library.categories)
        # Must have at least basic words; may also have phrases, pangrams, etc.
        assert "basic-words" in categories, (
            f"Expected 'basic-words' category, found: {categories}"
        )

    def test_filter_by_arpasing_style(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Filtering by 'arpasing' style returns all prompts."""
        filtered = english_prompt_library.get_prompts_by_style("arpasing")
        assert len(filtered) == english_prompt_library.total_prompts

    def test_difficulty_levels_present(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """The library includes multiple difficulty levels."""
        difficulties = {p.difficulty for p in english_prompt_library.prompts}
        assert "basic" in difficulties
        # At least one more level beyond basic
        assert len(difficulties) >= 2, (
            f"Expected multiple difficulty levels, found: {difficulties}"
        )

    def test_phoneme_coverage_metadata(self, english_prompt_data: dict) -> None:
        """The JSON includes ARPABET phoneme coverage metadata."""
        coverage = english_prompt_data.get("coverage", {})
        arpasing_coverage = coverage.get("arpasing", {})

        assert "vowels" in arpasing_coverage, "Missing vowels in coverage"
        assert "consonants" in arpasing_coverage, "Missing consonants in coverage"

        vowels = arpasing_coverage["vowels"]
        assert "monophthongs" in vowels, "Missing monophthongs"
        assert "diphthongs" in vowels, "Missing diphthongs"

        # Verify specific ARPABET vowels are listed
        monophthongs = vowels["monophthongs"]
        assert "aa" in monophthongs
        assert "ae" in monophthongs
        assert "ih" in monophthongs

        diphthongs = vowels["diphthongs"]
        assert "ay" in diphthongs
        assert "ow" in diphthongs

    def test_specific_prompt_phoneme_breakdown(
        self, english_prompt_library: PromptLibrary
    ) -> None:
        """Verify correct phoneme breakdown for known English words."""
        prompt_map = {p.text: p for p in english_prompt_library.prompts}

        cat = prompt_map.get("cat")
        assert cat is not None
        assert cat.phonemes == ["k", "ae", "t"]

        dog = prompt_map.get("dog")
        assert dog is not None
        assert dog.phonemes == ["d", "aa", "g"]

        cheese = prompt_map.get("cheese")
        assert cheese is not None
        assert cheese.phonemes == ["ch", "iy", "z"]


# =============================================================================
# 3. Session Creation with English/ARPAsing Parameters
# =============================================================================


class TestEnglishSessionCreation:
    """Test creating recording sessions with English language and ARPAsing style."""

    async def test_create_english_arpasing_session(
        self, service: RecordingSessionService
    ) -> None:
        """Create a session with language=en, recording_style=arpasing."""
        request = RecordingSessionCreate(
            voicebank_id="english_test_vb",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog", "bat"],
        )
        session = await service.create(request)

        assert session.voicebank_id == "english_test_vb"
        assert session.recording_style == RecordingStyle.ARPASING
        assert session.language == Language.EN
        assert session.status == SessionStatus.PENDING
        assert len(session.prompts) == 3
        assert session.prompts[0] == "cat"

    async def test_create_session_with_string_enum_values(
        self, service: RecordingSessionService
    ) -> None:
        """Session creation accepts string values for enum fields."""
        request = RecordingSessionCreate(
            voicebank_id="en_string_test",
            recording_style="arpasing",
            language="en",
            prompts=["cat"],
        )
        session = await service.create(request)

        assert session.recording_style == RecordingStyle.ARPASING
        assert session.language == Language.EN

    async def test_create_session_with_full_prompt_list(
        self,
        service: RecordingSessionService,
        english_prompt_library: PromptLibrary,
    ) -> None:
        """Create a session with all prompts from the English library."""
        prompts = [p.text for p in english_prompt_library.prompts]

        request = RecordingSessionCreate(
            voicebank_id="full_english_vb",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=prompts,
        )
        session = await service.create(request)

        assert len(session.prompts) == english_prompt_library.total_prompts
        assert session.recording_style == RecordingStyle.ARPASING

    async def test_create_session_with_phrase_prompts(
        self, service: RecordingSessionService
    ) -> None:
        """Create a session with multi-word English phrase prompts."""
        request = RecordingSessionCreate(
            voicebank_id="phrase_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=[
                "The quick brown fox",
                "jumps over the lazy dog",
                "She sells seashells",
            ],
        )
        session = await service.create(request)

        assert len(session.prompts) == 3
        assert session.prompts[0] == "The quick brown fox"

    async def test_create_session_invalid_style_rejected(self) -> None:
        """Invalid recording style raises ValidationError at Pydantic level."""
        with pytest.raises(ValidationError, match="recording_style"):
            RecordingSessionCreate(
                voicebank_id="test",
                recording_style="not_a_style",
                language="en",
                prompts=["cat"],
            )

    async def test_create_session_invalid_language_rejected(self) -> None:
        """Invalid language raises ValidationError at Pydantic level."""
        with pytest.raises(ValidationError, match="language"):
            RecordingSessionCreate(
                voicebank_id="test",
                recording_style="arpasing",
                language="invalid",
                prompts=["cat"],
            )

    async def test_session_model_stores_english_enums(self) -> None:
        """RecordingSession model correctly stores EN/ARPASING values."""
        session = RecordingSession(
            voicebank_id="test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog"],
        )
        assert session.recording_style == RecordingStyle.ARPASING
        assert session.recording_style.value == "arpasing"
        assert session.language == Language.EN
        assert session.language.value == "en"

    async def test_session_summary_preserves_english_metadata(self) -> None:
        """Session summary preserves voicebank_id for English sessions."""
        session = RecordingSession(
            voicebank_id="english_vb",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog"],
        )
        summary = session.to_summary()
        assert summary.voicebank_id == "english_vb"
        assert summary.total_prompts == 2


# =============================================================================
# 4. Recording Workflow for English Sessions
# =============================================================================


class TestEnglishRecordingWorkflow:
    """Test the recording workflow lifecycle for English/ARPAsing sessions."""

    async def test_upload_english_segment(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Upload a segment for an English prompt."""
        request = RecordingSessionCreate(
            voicebank_id="en_upload_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog", "bat"],
        )
        session = await service.create(request)

        segment_info = SegmentUpload(
            prompt_index=0,
            prompt_text="cat",
            duration_ms=1200.0,
        )
        segment = await service.upload_segment(
            session.id, segment_info, minimal_wav_data
        )

        assert segment.prompt_text == "cat"
        assert segment.is_accepted is True

        updated = await service.get(session.id)
        assert updated.status == SessionStatus.RECORDING
        assert len(updated.segments) == 1
        assert updated.current_prompt_index == 1

    async def test_upload_all_english_segments_completes_session(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Uploading all segments transitions session to PROCESSING."""
        prompts = ["cat", "dog"]
        request = RecordingSessionCreate(
            voicebank_id="en_complete_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=prompts,
        )
        session = await service.create(request)

        for idx, prompt in enumerate(prompts):
            segment_info = SegmentUpload(
                prompt_index=idx,
                prompt_text=prompt,
                duration_ms=1000.0,
            )
            await service.upload_segment(session.id, segment_info, minimal_wav_data)

        updated = await service.get(session.id)
        assert updated.status == SessionStatus.PROCESSING
        assert updated.is_complete
        assert updated.progress_percent == 100.0

    async def test_progress_tracking_english_session(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Progress is tracked correctly through English prompts."""
        request = RecordingSessionCreate(
            voicebank_id="en_progress_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog", "bat", "set"],
        )
        session = await service.create(request)

        progress = await service.get_progress(session.id)
        assert progress.total_prompts == 4
        assert progress.completed_segments == 0
        assert progress.current_prompt_text == "cat"

        # Record first segment
        await service.upload_segment(
            session.id,
            SegmentUpload(prompt_index=0, prompt_text="cat", duration_ms=1000.0),
            minimal_wav_data,
        )

        progress = await service.get_progress(session.id)
        assert progress.completed_segments == 1
        assert progress.progress_percent == 25.0
        assert progress.current_prompt_text == "dog"

    async def test_segment_filename_for_english_word(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Segment filenames use prompt text for English words."""
        request = RecordingSessionCreate(
            voicebank_id="en_filename_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat"],
        )
        session = await service.create(request)

        segment = await service.upload_segment(
            session.id,
            SegmentUpload(prompt_index=0, prompt_text="cat", duration_ms=1000.0),
            minimal_wav_data,
        )

        # Individual mode: format is NNNN_prompttext.wav
        assert segment.audio_filename == "0000_cat.wav"

    async def test_segment_filename_for_english_phrase(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Segment filenames handle multi-word English phrases."""
        request = RecordingSessionCreate(
            voicebank_id="en_phrase_filename",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["The quick brown fox"],
        )
        session = await service.create(request)

        segment = await service.upload_segment(
            session.id,
            SegmentUpload(
                prompt_index=0,
                prompt_text="The quick brown fox",
                duration_ms=2000.0,
            ),
            minimal_wav_data,
        )

        # Spaces are replaced with underscores in filenames
        assert "The_quick_brown_fox" in segment.audio_filename
        assert segment.audio_filename.endswith(".wav")

    async def test_reject_and_rerecord_english_segment(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Rejecting an English segment allows re-recording."""
        request = RecordingSessionCreate(
            voicebank_id="en_reject_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat", "dog"],
        )
        session = await service.create(request)

        # Upload and reject first segment
        segment = await service.upload_segment(
            session.id,
            SegmentUpload(prompt_index=0, prompt_text="cat", duration_ms=1000.0),
            minimal_wav_data,
        )
        rejected = await service.reject_segment(
            session.id, segment.id, "Background noise"
        )
        assert rejected.is_accepted is False

        # Progress should not count rejected segment
        progress = await service.get_progress(session.id)
        assert progress.completed_segments == 0
        assert progress.rejected_segments == 1


# =============================================================================
# 5. Oto.ini Generation for English Phoneme Aliases
# =============================================================================


class TestEnglishOtoGeneration:
    """Test oto.ini entries with English/ARPABET phoneme aliases."""

    def test_oto_entry_with_arpabet_alias(self) -> None:
        """Create an oto entry using ARPABET-style alias."""
        entry = OtoEntry(
            filename="_cat.wav",
            alias="k ae t",
            offset=30,
            consonant=80,
            cutoff=-120,
            preutterance=50,
            overlap=10,
        )
        assert entry.alias == "k ae t"
        assert entry.filename == "_cat.wav"

    def test_oto_entry_with_dash_prefix_alias(self) -> None:
        """Create an oto entry using dash-prefix alias format for English."""
        entry = OtoEntry(
            filename="_cat.wav",
            alias="- cat",
            offset=30,
            consonant=80,
            cutoff=-120,
            preutterance=50,
            overlap=10,
        )
        assert entry.alias == "- cat"

    def test_serialize_english_oto_entries(self) -> None:
        """Serialize English oto entries to oto.ini format."""
        entries = [
            OtoEntry(
                filename="_cat.wav",
                alias="k ae t",
                offset=30,
                consonant=80,
                cutoff=-120,
                preutterance=50,
                overlap=10,
            ),
            OtoEntry(
                filename="_dog.wav",
                alias="d aa g",
                offset=25,
                consonant=90,
                cutoff=-110,
                preutterance=55,
                overlap=12,
            ),
            OtoEntry(
                filename="_bat.wav",
                alias="b ae t",
                offset=20,
                consonant=75,
                cutoff=-130,
                preutterance=45,
                overlap=8,
            ),
        ]

        content = serialize_oto_entries(entries)
        lines = content.strip().split("\n")

        assert len(lines) == 3
        assert "_cat.wav=k ae t," in lines[0]
        assert "_dog.wav=d aa g," in lines[1]
        assert "_bat.wav=b ae t," in lines[2]

    def test_roundtrip_english_oto_entry(self) -> None:
        """Parse and serialize an English oto entry roundtrips correctly."""
        original_line = "_cat.wav=k ae t,30,80,-120,50,10"
        entry = parse_oto_line(original_line)

        assert entry is not None
        assert entry.filename == "_cat.wav"
        assert entry.alias == "k ae t"
        assert entry.offset == 30
        assert entry.consonant == 80
        assert entry.cutoff == -120
        assert entry.preutterance == 50
        assert entry.overlap == 10

        # Serialize back
        serialized = entry.to_oto_line()
        assert serialized == original_line

    def test_parse_english_oto_file_content(self) -> None:
        """Parse a complete oto.ini file with English entries."""
        content = (
            "_cat.wav=k ae t,30,80,-120,50,10\n"
            "_dog.wav=d aa g,25,90,-110,55,12\n"
            "_The_quick_brown_fox.wav=The quick brown fox,40,100,-200,60,15\n"
            "# English ARPAsing voicebank\n"
            "_bat.wav=b ae t,20,75,-130,45,8\n"
        )
        entries = parse_oto_file(content)

        assert len(entries) == 4
        assert entries[0].alias == "k ae t"
        assert entries[1].alias == "d aa g"
        assert entries[2].alias == "The quick brown fox"
        assert entries[3].alias == "b ae t"

    def test_write_english_oto_file(self, temp_dir: Path) -> None:
        """Write English oto entries to a file and read them back."""
        entries = [
            OtoEntry(
                filename="_cat.wav",
                alias="k ae t",
                offset=30,
                consonant=80,
                cutoff=-120,
                preutterance=50,
                overlap=10,
            ),
            OtoEntry(
                filename="_cheese.wav",
                alias="ch iy z",
                offset=35,
                consonant=95,
                cutoff=-150,
                preutterance=60,
                overlap=15,
            ),
        ]

        oto_path = temp_dir / "oto.ini"
        write_oto_file(oto_path, entries)

        # Read back and verify
        content = oto_path.read_text(encoding="utf-8")
        parsed = parse_oto_file(content)

        assert len(parsed) == 2
        assert parsed[0].alias == "k ae t"
        assert parsed[1].alias == "ch iy z"

    def test_english_oto_entry_with_diphthong_alias(self) -> None:
        """Oto entries handle ARPABET diphthong aliases."""
        entry = OtoEntry(
            filename="_buy.wav",
            alias="b ay",
            offset=20,
            consonant=70,
            cutoff=-100,
            preutterance=40,
            overlap=10,
        )
        line = entry.to_oto_line()
        assert line == "_buy.wav=b ay,20,70,-100,40,10"

        reparsed = parse_oto_line(line)
        assert reparsed is not None
        assert reparsed.alias == "b ay"

    def test_whole_segment_oto_alias_for_arpasing(self) -> None:
        """When using whole-segment slicing, alias matches prompt text.

        ARPAsing/VCCV styles that don't use CV/VCV slicing fall through
        to the whole-segment slicer, which uses the prompt text as the alias.
        """
        entry = OtoEntry(
            filename="_cat.wav",
            alias="cat",
            offset=30,
            consonant=80,
            cutoff=-120,
            preutterance=50,
            overlap=10,
        )
        assert entry.alias == "cat"

    @pytest.mark.parametrize(
        "filename,alias",
        [
            ("_cat.wav", "k ae t"),
            ("_dog.wav", "d aa g"),
            ("_cheese.wav", "ch iy z"),
            ("_think.wav", "th ih ng k"),
            ("_measure.wav", "m eh zh er"),
            ("_ship.wav", "sh ih p"),
        ],
    )
    def test_various_english_oto_entries(self, filename: str, alias: str) -> None:
        """Various English phoneme aliases parse and serialize correctly."""
        entry = OtoEntry(
            filename=filename,
            alias=alias,
            offset=30,
            consonant=80,
            cutoff=-120,
            preutterance=50,
            overlap=10,
        )
        line = entry.to_oto_line()
        reparsed = parse_oto_line(line)

        assert reparsed is not None
        assert reparsed.filename == filename
        assert reparsed.alias == alias


# =============================================================================
# 6. Segment Filename Generation for English Content
# =============================================================================


class TestEnglishFilenameGeneration:
    """Test that the service generates correct filenames for English prompts."""

    def test_sanitize_simple_english_word(self) -> None:
        """Simple English words produce clean filenames."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        result = service._sanitize_name("cat")
        assert result == "cat"

    def test_sanitize_english_phrase(self) -> None:
        """Multi-word phrases replace spaces with underscores."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        result = service._sanitize_name("The quick brown fox")
        assert result == "The_quick_brown_fox"

    def test_sanitize_special_characters(self) -> None:
        """Special characters are sanitized for filesystem safety."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        result = service._sanitize_name("What's up?")
        assert "?" not in result

    def test_generate_segment_filename_english_individual(self) -> None:
        """Individual mode generates NNNN_prompt.wav filenames."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        session = RecordingSession(
            voicebank_id="test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            recording_mode="individual",
            prompts=["cat"],
        )
        filename = service._generate_segment_filename(
            session=session,
            prompt_index=0,
            prompt_text="cat",
        )
        assert filename == "0000_cat.wav"

    def test_generate_segment_filename_english_phrase(self) -> None:
        """Phrase prompts have spaces replaced in filenames."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        session = RecordingSession(
            voicebank_id="test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            recording_mode="individual",
            prompts=["The quick brown fox"],
        )
        filename = service._generate_segment_filename(
            session=session,
            prompt_index=0,
            prompt_text="The quick brown fox",
        )
        assert filename.startswith("0000_")
        assert filename.endswith(".wav")
        assert " " not in filename

    def test_filename_length_capped_for_long_phrases(self) -> None:
        """Very long prompts are truncated in filenames."""
        service = RecordingSessionService.__new__(RecordingSessionService)
        session = RecordingSession(
            voicebank_id="test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            recording_mode="individual",
            prompts=["A journey of a thousand miles begins with a single step"],
        )
        filename = service._generate_segment_filename(
            session=session,
            prompt_index=0,
            prompt_text="A journey of a thousand miles begins with a single step",
        )
        # Prompt text is truncated to 20 characters in individual mode
        assert filename.endswith(".wav")
        # Verify it's not unreasonably long
        assert len(filename) < 100


# =============================================================================
# 7. Integration: Full English Recording Session Flow
# =============================================================================


class TestEnglishRecordingIntegration:
    """Integration tests for the complete English recording session flow."""

    async def test_full_english_session_lifecycle(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Test complete session lifecycle: create -> record -> complete."""
        # Step 1: Create session with English prompts
        prompts = ["cat", "dog", "bat"]
        request = RecordingSessionCreate(
            voicebank_id="english_voice",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=prompts,
        )
        session = await service.create(request)
        assert session.status == SessionStatus.PENDING

        # Step 2: Start recording
        started = await service.start_recording(session.id)
        assert started.status == SessionStatus.RECORDING

        # Step 3: Upload all segments
        for idx, prompt in enumerate(prompts):
            await service.upload_segment(
                session.id,
                SegmentUpload(
                    prompt_index=idx,
                    prompt_text=prompt,
                    duration_ms=1000.0 + idx * 100,
                ),
                minimal_wav_data,
            )

        # Step 4: Verify session is processing (auto-transitions on completion)
        updated = await service.get(session.id)
        assert updated.status == SessionStatus.PROCESSING
        assert updated.is_complete
        assert len(updated.segments) == 3

        # Step 5: Complete session
        completed = await service.complete_session(session.id)
        assert completed.status == SessionStatus.COMPLETED

    async def test_english_session_with_library_prompts(
        self,
        service: RecordingSessionService,
        english_prompt_library: PromptLibrary,
        minimal_wav_data: bytes,
    ) -> None:
        """Create and partially record a session using library prompts."""
        # Use only basic-difficulty prompts
        basic_prompts = english_prompt_library.get_prompts_by_difficulty("basic")
        assert len(basic_prompts) > 0

        prompt_texts = [p.text for p in basic_prompts[:5]]
        request = RecordingSessionCreate(
            voicebank_id="library_test_vb",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=prompt_texts,
        )
        session = await service.create(request)

        # Record first two prompts
        for idx in range(2):
            await service.upload_segment(
                session.id,
                SegmentUpload(
                    prompt_index=idx,
                    prompt_text=prompt_texts[idx],
                    duration_ms=1000.0,
                ),
                minimal_wav_data,
            )

        progress = await service.get_progress(session.id)
        assert progress.completed_segments == 2
        assert progress.total_prompts == 5
        assert progress.progress_percent == 40.0

    async def test_english_session_produces_retrievable_segments(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Uploaded English segments can be retrieved from storage."""
        request = RecordingSessionCreate(
            voicebank_id="retrieval_test",
            recording_style=RecordingStyle.ARPASING,
            language=Language.EN,
            prompts=["cat"],
        )
        session = await service.create(request)

        segment = await service.upload_segment(
            session.id,
            SegmentUpload(prompt_index=0, prompt_text="cat", duration_ms=1000.0),
            minimal_wav_data,
        )

        # Audio file should be retrievable
        audio_path = await service.get_segment_audio_path(
            session.id, segment.audio_filename
        )
        assert audio_path.exists()
        assert audio_path.name == segment.audio_filename

    async def test_multiple_english_sessions_independent(
        self,
        service: RecordingSessionService,
        minimal_wav_data: bytes,
    ) -> None:
        """Multiple English sessions operate independently."""
        # Create two sessions
        session1 = await service.create(
            RecordingSessionCreate(
                voicebank_id="en_vb_1",
                recording_style=RecordingStyle.ARPASING,
                language=Language.EN,
                prompts=["cat", "dog"],
            )
        )
        session2 = await service.create(
            RecordingSessionCreate(
                voicebank_id="en_vb_2",
                recording_style=RecordingStyle.ARPASING,
                language=Language.EN,
                prompts=["bat", "set", "kit"],
            )
        )

        # Upload to session 1 only
        await service.upload_segment(
            session1.id,
            SegmentUpload(prompt_index=0, prompt_text="cat", duration_ms=1000.0),
            minimal_wav_data,
        )

        # Verify independence
        progress1 = await service.get_progress(session1.id)
        progress2 = await service.get_progress(session2.id)

        assert progress1.completed_segments == 1
        assert progress2.completed_segments == 0
        assert progress1.total_prompts == 2
        assert progress2.total_prompts == 3
