"""Tests for the BatchOtoService batch processing functionality."""

import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

from src.backend.domain.batch_oto import BatchOtoResult
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.oto_suggestion import OtoSuggestion
from src.backend.domain.phoneme import PhonemeSegment
from src.backend.services.batch_oto_service import BatchOtoService


class TestBatchOtoServiceGenerateOto:
    """Tests for BatchOtoService.generate_oto_for_voicebank()."""

    @pytest.fixture
    def mock_voicebank_service(self) -> MagicMock:
        """Create mock voicebank service."""
        service = MagicMock()
        service.get = AsyncMock()
        service.list_samples = AsyncMock()
        service.get_sample_path = AsyncMock()
        return service

    @pytest.fixture
    def mock_oto_suggester(self) -> MagicMock:
        """Create mock oto suggester."""
        suggester = MagicMock()
        suggester.batch_suggest_oto = AsyncMock()
        suggester.suggest_oto = AsyncMock()
        return suggester

    @pytest.fixture
    def mock_oto_repository(self) -> MagicMock:
        """Create mock oto repository."""
        repo = MagicMock()
        repo.get_entries = AsyncMock(return_value=[])
        repo.save_entries = AsyncMock()
        return repo

    @pytest.fixture
    def batch_service(
        self,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> BatchOtoService:
        """Create BatchOtoService with mocked dependencies."""
        return BatchOtoService(
            voicebank_service=mock_voicebank_service,
            oto_suggester=mock_oto_suggester,
            oto_repository=mock_oto_repository,
        )

    @pytest.mark.asyncio
    async def test_generate_oto_uses_batch_processing(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Verify batch_suggest_oto is called instead of individual suggest_oto calls."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav", "_sa.wav", "_ta.wav"]
        sample_paths = [Path(f"/voicebanks/{voicebank_id}/{s}") for s in samples]

        # Setup mocks
        mock_voicebank_service.get.return_value = {"id": voicebank_id, "name": "Test VB"}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.side_effect = sample_paths

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename=s,
                alias=f"- {s.replace('_', '').replace('.wav', '')}",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            )
            for s in samples
        ]

        result = await batch_service.generate_oto_for_voicebank(
            voicebank_id, sofa_language="ja"
        )

        # Verify batch_suggest_oto was called ONCE with all paths
        mock_oto_suggester.batch_suggest_oto.assert_called_once()
        call_args = mock_oto_suggester.batch_suggest_oto.call_args
        paths_arg = call_args[0][0]  # First positional argument
        assert len(paths_arg) == 3

        # Verify suggest_oto was NOT called (batch was used)
        mock_oto_suggester.suggest_oto.assert_not_called()

        # Verify result
        assert result.total_samples == 3
        assert result.processed == 3
        assert result.skipped == 0
        assert result.failed == 0

    @pytest.mark.asyncio
    async def test_generate_oto_with_sofa_language(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Language parameter is passed correctly to batch_suggest_oto."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav"]
        sample_path = Path(f"/voicebanks/{voicebank_id}/_ka.wav")

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.return_value = sample_path

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename="_ka.wav",
                alias="- ka",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            )
        ]

        # Test with Japanese
        await batch_service.generate_oto_for_voicebank(
            voicebank_id, sofa_language="ja"
        )
        assert mock_oto_suggester.batch_suggest_oto.call_args[1]["sofa_language"] == "ja"

        mock_oto_suggester.batch_suggest_oto.reset_mock()

        # Test with English
        await batch_service.generate_oto_for_voicebank(
            voicebank_id, sofa_language="en"
        )
        assert mock_oto_suggester.batch_suggest_oto.call_args[1]["sofa_language"] == "en"

    @pytest.mark.asyncio
    async def test_generate_oto_progress_callback(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Progress callback is called at start and completion."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav", "_sa.wav"]
        sample_paths = [Path(f"/voicebanks/{voicebank_id}/{s}") for s in samples]

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.side_effect = sample_paths

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename=s,
                alias=f"- {s.replace('_', '').replace('.wav', '')}",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            )
            for s in samples
        ]

        # Track progress callback calls
        progress_calls = []

        def progress_callback(current: int, total: int, message: str) -> None:
            progress_calls.append((current, total, message))

        await batch_service.generate_oto_for_voicebank(
            voicebank_id, progress_callback=progress_callback
        )

        # Verify progress was reported at start and completion
        assert len(progress_calls) >= 2

        # First call: starting batch
        assert progress_calls[0][0] == 0  # current = 0
        assert progress_calls[0][1] == 2  # total = 2
        assert "Starting" in progress_calls[0][2] or "batch" in progress_calls[0][2].lower()

        # Last call: completion
        assert progress_calls[-1][0] == 2  # current = total
        assert progress_calls[-1][1] == 2
        assert "complete" in progress_calls[-1][2].lower() or "processed" in progress_calls[-1][2].lower()

    @pytest.mark.asyncio
    async def test_generate_oto_skips_existing_entries(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Files with existing oto entries are skipped when overwrite_existing=False."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav", "_sa.wav", "_ta.wav"]

        # _ka.wav already has an entry
        existing_entries = [
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            )
        ]

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.side_effect = [
            Path(f"/voicebanks/{voicebank_id}/{s}") for s in samples
        ]
        mock_oto_repository.get_entries.return_value = existing_entries

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename="_sa.wav",
                alias="- sa",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            ),
            OtoSuggestion(
                filename="_ta.wav",
                alias="- ta",
                offset=22.0,
                consonant=105.0,
                cutoff=-35.0,
                preutterance=62.0,
                overlap=27.0,
                confidence=0.82,
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        result = await batch_service.generate_oto_for_voicebank(
            voicebank_id, overwrite_existing=False
        )

        # Verify _ka.wav was skipped
        assert result.skipped == 1
        assert result.processed == 2
        assert result.total_samples == 3

        # Verify batch_suggest_oto was called with only 2 paths (not 3)
        call_args = mock_oto_suggester.batch_suggest_oto.call_args
        paths_arg = call_args[0][0]
        assert len(paths_arg) == 2

    @pytest.mark.asyncio
    async def test_generate_oto_overwrites_existing_entries(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Files with existing oto entries are processed when overwrite_existing=True."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav", "_sa.wav"]

        existing_entries = [
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            )
        ]

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.side_effect = [
            Path(f"/voicebanks/{voicebank_id}/{s}") for s in samples
        ]
        mock_oto_repository.get_entries.return_value = existing_entries

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename="_ka.wav",
                alias="- ka NEW",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            ),
            OtoSuggestion(
                filename="_sa.wav",
                alias="- sa",
                offset=22.0,
                consonant=105.0,
                cutoff=-35.0,
                preutterance=62.0,
                overlap=27.0,
                confidence=0.82,
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        result = await batch_service.generate_oto_for_voicebank(
            voicebank_id, overwrite_existing=True
        )

        # Verify nothing was skipped
        assert result.skipped == 0
        assert result.processed == 2

        # Verify batch_suggest_oto was called with all paths
        call_args = mock_oto_suggester.batch_suggest_oto.call_args
        paths_arg = call_args[0][0]
        assert len(paths_arg) == 2

    @pytest.mark.asyncio
    async def test_generate_oto_tracks_low_confidence(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Low confidence files are tracked but not marked as failed."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav", "_sa.wav"]

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.side_effect = [
            Path(f"/voicebanks/{voicebank_id}/{s}") for s in samples
        ]

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename="_ka.wav",
                alias="- ka",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,  # Good confidence
                phonemes_detected=[],
                audio_duration_ms=250.0,
            ),
            OtoSuggestion(
                filename="_sa.wav",
                alias="- sa",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.1,  # LOW confidence
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        result = await batch_service.generate_oto_for_voicebank(voicebank_id)

        # Both were processed (low confidence is not a failure)
        assert result.processed == 2
        assert result.failed == 0

        # Average confidence reflects the low value
        expected_avg = (0.85 + 0.1) / 2
        assert result.average_confidence == pytest.approx(expected_avg, rel=0.01)

    @pytest.mark.asyncio
    async def test_generate_oto_empty_voicebank(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Empty voicebank returns result with zero counts."""
        voicebank_id = "empty-vb"

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = []

        result = await batch_service.generate_oto_for_voicebank(voicebank_id)

        assert result.total_samples == 0
        assert result.processed == 0
        assert result.skipped == 0
        assert result.failed == 0
        assert result.entries == []

        # batch_suggest_oto should not be called for empty voicebank
        mock_oto_suggester.batch_suggest_oto.assert_not_called()

    @pytest.mark.asyncio
    async def test_generate_oto_saves_entries(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Generated entries are saved to repository."""
        voicebank_id = "test-vb"
        samples = ["_ka.wav"]

        mock_voicebank_service.get.return_value = {"id": voicebank_id}
        mock_voicebank_service.list_samples.return_value = samples
        mock_voicebank_service.get_sample_path.return_value = Path(
            f"/voicebanks/{voicebank_id}/_ka.wav"
        )

        mock_oto_suggester.batch_suggest_oto.return_value = [
            OtoSuggestion(
                filename="_ka.wav",
                alias="- ka",
                offset=20.0,
                consonant=100.0,
                cutoff=-30.0,
                preutterance=60.0,
                overlap=25.0,
                confidence=0.85,
                phonemes_detected=[],
                audio_duration_ms=250.0,
            )
        ]

        await batch_service.generate_oto_for_voicebank(voicebank_id)

        # Verify save_entries was called
        mock_oto_repository.save_entries.assert_called_once()
        save_call_args = mock_oto_repository.save_entries.call_args
        assert save_call_args[0][0] == voicebank_id
        saved_entries = save_call_args[0][1]
        assert len(saved_entries) == 1
        assert saved_entries[0].filename == "_ka.wav"


class TestBatchOtoResult:
    """Tests for BatchOtoResult model."""

    def test_batch_oto_result_valid(self) -> None:
        """Test creating a valid BatchOtoResult."""
        result = BatchOtoResult(
            voicebank_id="test-vb",
            total_samples=10,
            processed=8,
            skipped=1,
            failed=1,
            entries=[
                OtoEntry(
                    filename="_ka.wav",
                    alias="- ka",
                    offset=20.0,
                    consonant=100.0,
                    cutoff=-30.0,
                    preutterance=60.0,
                    overlap=25.0,
                )
            ],
            failed_files=["_error.wav"],
            average_confidence=0.85,
        )

        assert result.voicebank_id == "test-vb"
        assert result.total_samples == 10
        assert result.processed == 8
        assert result.skipped == 1
        assert result.failed == 1
        assert len(result.entries) == 1
        assert result.failed_files == ["_error.wav"]
        assert result.average_confidence == 0.85

    def test_batch_oto_result_defaults(self) -> None:
        """Test BatchOtoResult with default values."""
        result = BatchOtoResult(
            voicebank_id="test-vb",
            total_samples=0,
            processed=0,
            skipped=0,
            failed=0,
            average_confidence=0.0,
        )

        assert result.entries == []
        assert result.failed_files == []
