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
    async def test_generate_oto_gates_low_confidence(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Low confidence entries are not saved but returned for review."""
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
                confidence=0.1,  # LOW confidence (below 0.3 threshold)
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        result = await batch_service.generate_oto_for_voicebank(voicebank_id)

        # Both were processed (low confidence is not a failure)
        assert result.processed == 2
        assert result.failed == 0

        # Only the high-confidence entry is in entries (saved)
        assert len(result.entries) == 1
        assert result.entries[0].filename == "_ka.wav"

        # The low-confidence entry is in pending_review_entries (not saved)
        assert len(result.pending_review_entries) == 1
        assert result.pending_review_entries[0].filename == "_sa.wav"

        # Low confidence files are tracked
        assert result.low_confidence_files == ["_sa.wav"]

        # Confidence threshold is reported
        assert result.confidence_threshold == 0.3

        # Average confidence reflects both entries
        expected_avg = (0.85 + 0.1) / 2
        assert result.average_confidence == pytest.approx(expected_avg, rel=0.01)

        # Verify only the high-confidence entry was saved to repository
        mock_oto_repository.save_entries.assert_called_once()
        save_call_args = mock_oto_repository.save_entries.call_args
        saved_entries = save_call_args[0][1]
        assert len(saved_entries) == 1
        assert saved_entries[0].filename == "_ka.wav"

    @pytest.mark.asyncio
    async def test_generate_oto_all_low_confidence_saves_nothing(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """When all entries are low confidence, nothing is saved to oto.ini."""
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
                confidence=0.15,  # LOW
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
                confidence=0.2,  # LOW
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        result = await batch_service.generate_oto_for_voicebank(voicebank_id)

        # Both processed but none saved
        assert result.processed == 2
        assert result.entries == []
        assert len(result.pending_review_entries) == 2
        assert result.low_confidence_files == ["_ka.wav", "_sa.wav"]

        # Repository save_entries should NOT have been called
        mock_oto_repository.save_entries.assert_not_called()

    @pytest.mark.asyncio
    async def test_generate_oto_custom_confidence_threshold(
        self,
        batch_service: BatchOtoService,
        mock_voicebank_service: MagicMock,
        mock_oto_suggester: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Custom confidence threshold is respected."""
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
                confidence=0.5,  # Would pass default 0.3 but not 0.6
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
                confidence=0.7,  # Passes 0.6 threshold
                phonemes_detected=[],
                audio_duration_ms=260.0,
            ),
        ]

        # Use a higher threshold (0.6)
        result = await batch_service.generate_oto_for_voicebank(
            voicebank_id, confidence_threshold=0.6
        )

        # Only the 0.7 entry should be saved
        assert len(result.entries) == 1
        assert result.entries[0].filename == "_sa.wav"

        # The 0.5 entry should be pending review
        assert len(result.pending_review_entries) == 1
        assert result.pending_review_entries[0].filename == "_ka.wav"

        # Threshold is reported in result
        assert result.confidence_threshold == 0.6

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
        pending_entry = OtoEntry(
            filename="_low.wav",
            alias="- low",
            offset=10.0,
            consonant=80.0,
            cutoff=-20.0,
            preutterance=50.0,
            overlap=20.0,
        )
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
            pending_review_entries=[pending_entry],
            failed_files=["_error.wav"],
            low_confidence_files=["_low.wav"],
            average_confidence=0.85,
            confidence_threshold=0.3,
        )

        assert result.voicebank_id == "test-vb"
        assert result.total_samples == 10
        assert result.processed == 8
        assert result.skipped == 1
        assert result.failed == 1
        assert len(result.entries) == 1
        assert len(result.pending_review_entries) == 1
        assert result.pending_review_entries[0].filename == "_low.wav"
        assert result.failed_files == ["_error.wav"]
        assert result.low_confidence_files == ["_low.wav"]
        assert result.average_confidence == 0.85
        assert result.confidence_threshold == 0.3

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
        assert result.pending_review_entries == []
        assert result.failed_files == []
        assert result.low_confidence_files == []
        assert result.confidence_threshold == 0.3
