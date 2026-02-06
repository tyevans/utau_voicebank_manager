"""Tests for the SOFA (Singing-Oriented Forced Aligner) integration."""

import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.domain.phoneme import PhonemeSegment
from src.backend.ml.forced_aligner import AlignmentError, AlignmentResult
from src.backend.ml.sofa_aligner import (
    MODEL_CACHE_TTL_SECONDS,
    CachedSOFAModel,
    SOFAForcedAligner,
    SOFAModelManager,
    clear_sofa_model_cache,
    get_model_manager,
    get_sofa_aligner,
    is_sofa_available,
)


class TestSOFAForcedAlignerBatchAlign:
    """Tests for SOFAForcedAligner.batch_align() method."""

    @pytest.fixture
    def mock_sofa_aligner(self) -> SOFAForcedAligner:
        """Create a SOFA aligner with mocked paths for testing."""
        aligner = SOFAForcedAligner(
            sofa_path="/fake/sofa",
            checkpoints_dir="/fake/ckpt",
            dictionary_dir="/fake/dict",
        )
        return aligner

    @pytest.mark.asyncio
    async def test_batch_align_empty_list_returns_empty_dict(
        self, mock_sofa_aligner: SOFAForcedAligner
    ) -> None:
        """Empty input returns empty dict without any processing."""
        result = await mock_sofa_aligner.batch_align([], language="ja")
        assert result == {}

    @pytest.mark.asyncio
    async def test_batch_align_unavailable_raises_error(
        self, mock_sofa_aligner: SOFAForcedAligner
    ) -> None:
        """batch_align raises AlignmentError when SOFA is not available."""
        # Aligner with fake paths will have is_available() return False
        items = [(Path("/fake/audio.wav"), "ka")]

        with pytest.raises(AlignmentError, match="not installed or not properly configured"):
            await mock_sofa_aligner.batch_align(items, language="ja")

    @pytest.mark.asyncio
    async def test_batch_align_single_file(self) -> None:
        """Single file is processed correctly through batch_align."""
        aligner = SOFAForcedAligner()

        # Create mock alignment result
        mock_result = AlignmentResult(
            segments=[
                PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0),
                PhonemeSegment(phoneme="a", start_ms=60.0, end_ms=200.0, confidence=1.0),
            ],
            audio_duration_ms=250.0,
            method="sofa",
        )

        audio_path = Path("/test/audio/_ka.wav")
        items = [(audio_path, "k a")]

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_get_model_paths", return_value=(Path("/ckpt"), Path("/dict"))), \
             patch.object(aligner, "_prepare_audio", new_callable=AsyncMock), \
             patch.object(aligner, "_parse_textgrid", new_callable=AsyncMock, return_value=mock_result), \
             patch("asyncio.create_subprocess_exec") as mock_subprocess, \
             patch("tempfile.mkdtemp", return_value="/tmp/sofa_batch_test"), \
             patch("shutil.rmtree"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.write_text"), \
             patch("pathlib.Path.exists", return_value=True):

            # Mock subprocess
            mock_process = AsyncMock()
            mock_process.returncode = 0
            mock_process.communicate = AsyncMock(return_value=(b"", b""))
            mock_subprocess.return_value = mock_process

            result = await aligner.batch_align(items, language="ja")

            assert audio_path in result
            assert result[audio_path].method == "sofa"
            assert len(result[audio_path].segments) == 2
            assert result[audio_path].segments[0].phoneme == "k"

    @pytest.mark.asyncio
    async def test_batch_align_multiple_files(self) -> None:
        """Multiple files are processed in one SOFA invocation."""
        aligner = SOFAForcedAligner()

        audio_paths = [
            Path("/test/audio/_ka.wav"),
            Path("/test/audio/_sa.wav"),
            Path("/test/audio/_ta.wav"),
        ]
        items = [
            (audio_paths[0], "k a"),
            (audio_paths[1], "s a"),
            (audio_paths[2], "t a"),
        ]

        mock_results = {
            audio_paths[0]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            ),
            audio_paths[1]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="s", start_ms=25.0, end_ms=70.0, confidence=1.0)],
                audio_duration_ms=260.0,
                method="sofa",
            ),
            audio_paths[2]: AlignmentResult(
                segments=[PhonemeSegment(phoneme="t", start_ms=30.0, end_ms=65.0, confidence=1.0)],
                audio_duration_ms=240.0,
                method="sofa",
            ),
        }

        parse_call_count = 0

        async def mock_parse_textgrid(textgrid_path, _original_path):
            nonlocal parse_call_count
            # Map temp filename back to original path based on index
            idx = int(textgrid_path.stem.split("_")[1])
            result_path = audio_paths[idx]
            parse_call_count += 1
            return mock_results[result_path]

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_get_model_paths", return_value=(Path("/ckpt"), Path("/dict"))), \
             patch.object(aligner, "_prepare_audio", new_callable=AsyncMock), \
             patch.object(aligner, "_parse_textgrid", side_effect=mock_parse_textgrid), \
             patch("asyncio.create_subprocess_exec") as mock_subprocess, \
             patch("tempfile.mkdtemp", return_value="/tmp/sofa_batch_test"), \
             patch("shutil.rmtree"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.write_text"), \
             patch("pathlib.Path.exists", return_value=True):

            mock_process = AsyncMock()
            mock_process.returncode = 0
            mock_process.communicate = AsyncMock(return_value=(b"", b""))
            mock_subprocess.return_value = mock_process

            result = await aligner.batch_align(items, language="ja")

            # Verify subprocess was called exactly once for all files
            assert mock_subprocess.call_count == 1

            # Verify all files are in result
            assert len(result) == 3
            for path in audio_paths:
                assert path in result

    @pytest.mark.asyncio
    async def test_batch_align_partial_failure(self) -> None:
        """Some files fail, others succeed - returns partial results."""
        aligner = SOFAForcedAligner()

        audio_paths = [
            Path("/test/audio/_ka.wav"),
            Path("/test/audio/_sa.wav"),  # This one will fail
            Path("/test/audio/_ta.wav"),
        ]
        items = [
            (audio_paths[0], "k a"),
            (audio_paths[1], "s a"),
            (audio_paths[2], "t a"),
        ]

        async def mock_parse_textgrid(textgrid_path, _original_path):
            # Simulate failure for _sa.wav by raising exception
            idx = int(textgrid_path.stem.split("_")[1])
            if idx == 1:  # _sa.wav
                raise ValueError("Failed to parse TextGrid")
            return AlignmentResult(
                segments=[PhonemeSegment(phoneme="x", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            )

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_get_model_paths", return_value=(Path("/ckpt"), Path("/dict"))), \
             patch.object(aligner, "_prepare_audio", new_callable=AsyncMock), \
             patch.object(aligner, "_parse_textgrid", side_effect=mock_parse_textgrid), \
             patch("asyncio.create_subprocess_exec") as mock_subprocess, \
             patch("tempfile.mkdtemp", return_value="/tmp/sofa_batch_test"), \
             patch("shutil.rmtree"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.write_text"), \
             patch("pathlib.Path.exists", return_value=True):

            mock_process = AsyncMock()
            mock_process.returncode = 0
            mock_process.communicate = AsyncMock(return_value=(b"", b""))
            mock_subprocess.return_value = mock_process

            result = await aligner.batch_align(items, language="ja")

            # Should have partial results (2 out of 3)
            assert len(result) == 2
            assert audio_paths[0] in result
            assert audio_paths[1] not in result  # Failed
            assert audio_paths[2] in result

    @pytest.mark.asyncio
    async def test_batch_align_all_fail_raises_error(self) -> None:
        """When all files fail, raise AlignmentError."""
        aligner = SOFAForcedAligner()

        audio_paths = [
            Path("/test/audio/_ka.wav"),
            Path("/test/audio/_sa.wav"),
        ]
        items = [
            (audio_paths[0], "k a"),
            (audio_paths[1], "s a"),
        ]

        async def mock_parse_textgrid_always_fail(_textgrid_path, _original_path):
            raise ValueError("Failed to parse TextGrid")

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_get_model_paths", return_value=(Path("/ckpt"), Path("/dict"))), \
             patch.object(aligner, "_prepare_audio", new_callable=AsyncMock), \
             patch.object(aligner, "_parse_textgrid", side_effect=mock_parse_textgrid_always_fail), \
             patch("asyncio.create_subprocess_exec") as mock_subprocess, \
             patch("tempfile.mkdtemp", return_value="/tmp/sofa_batch_test"), \
             patch("shutil.rmtree"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.write_text"), \
             patch("pathlib.Path.exists", return_value=True):

            mock_process = AsyncMock()
            mock_process.returncode = 0
            mock_process.communicate = AsyncMock(return_value=(b"", b""))
            mock_subprocess.return_value = mock_process

            with pytest.raises(AlignmentError, match="produced no results"):
                await aligner.batch_align(items, language="ja")

    @pytest.mark.asyncio
    async def test_batch_align_subprocess_failure(self) -> None:
        """SOFA subprocess failure raises AlignmentError."""
        aligner = SOFAForcedAligner()

        items = [(Path("/test/audio/_ka.wav"), "k a")]

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_get_model_paths", return_value=(Path("/ckpt"), Path("/dict"))), \
             patch.object(aligner, "_prepare_audio", new_callable=AsyncMock), \
             patch("asyncio.create_subprocess_exec") as mock_subprocess, \
             patch("tempfile.mkdtemp", return_value="/tmp/sofa_batch_test"), \
             patch("shutil.rmtree"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.write_text"):

            mock_process = AsyncMock()
            mock_process.returncode = 1  # Non-zero exit code
            mock_process.communicate = AsyncMock(return_value=(b"", b"SOFA error"))
            mock_subprocess.return_value = mock_process

            with pytest.raises(AlignmentError, match="batch alignment failed"):
                await aligner.batch_align(items, language="ja")


class TestSOFAForcedAlignerAvailability:
    """Tests for SOFA availability checking."""

    def test_is_available_false_when_path_not_found(self) -> None:
        """is_available returns False when SOFA path doesn't exist."""
        aligner = SOFAForcedAligner(sofa_path="/nonexistent/path")
        assert aligner.is_available() is False

    def test_is_available_false_when_infer_py_missing(self) -> None:
        """is_available returns False when infer.py is missing."""
        with patch("pathlib.Path.exists") as mock_exists:
            # sofa_path exists but infer.py doesn't
            mock_exists.side_effect = lambda: False
            aligner = SOFAForcedAligner(sofa_path="/fake/sofa")
            assert aligner.is_available() is False

    def test_get_available_languages_empty_when_no_models(self) -> None:
        """get_available_languages returns empty list when no models installed."""
        aligner = SOFAForcedAligner(
            checkpoints_dir="/nonexistent/ckpt",
            dictionary_dir="/nonexistent/dict",
        )
        assert aligner.get_available_languages() == []


class TestSOFAModuleFunctions:
    """Tests for module-level convenience functions."""

    def test_get_sofa_aligner_returns_instance(self) -> None:
        """get_sofa_aligner returns a SOFAForcedAligner instance."""
        aligner = get_sofa_aligner()
        assert isinstance(aligner, SOFAForcedAligner)

    def test_is_sofa_available_returns_bool(self) -> None:
        """is_sofa_available returns a boolean."""
        result = is_sofa_available()
        assert isinstance(result, bool)


class TestSOFALanguageSupport:
    """Tests for SOFA language configuration."""

    def test_checkpoints_mapping_has_expected_languages(self) -> None:
        """CHECKPOINTS has expected language keys."""
        expected_languages = {"en", "zh", "ko", "fr", "ja"}
        actual_languages = set(SOFAForcedAligner.CHECKPOINTS.keys())
        assert expected_languages == actual_languages

    def test_dictionaries_mapping_has_expected_languages(self) -> None:
        """DICTIONARIES has expected language keys."""
        expected_languages = {"en", "zh", "ko", "fr", "ja"}
        actual_languages = set(SOFAForcedAligner.DICTIONARIES.keys())
        assert expected_languages == actual_languages

    def test_get_model_paths_unsupported_language_raises(self) -> None:
        """_get_model_paths raises AlignmentError for unsupported language."""
        aligner = SOFAForcedAligner()
        with pytest.raises(AlignmentError, match="Unsupported language"):
            aligner._get_model_paths("xyz")


class TestCachedSOFAModel:
    """Tests for CachedSOFAModel TTL caching."""

    def test_touch_updates_last_accessed(self) -> None:
        """touch() updates the last_accessed timestamp."""
        mock_device = MagicMock()
        cached = CachedSOFAModel(
            model=MagicMock(),
            g2p=MagicMock(),
            device=mock_device,
            checkpoint_path=Path("/fake/ckpt"),
            dictionary_path=Path("/fake/dict"),
            last_accessed=time.time() - 100,  # Set old timestamp
        )
        old_time = cached.last_accessed

        cached.touch()

        assert cached.last_accessed > old_time
        assert cached.last_accessed <= time.time()

    def test_is_expired_returns_false_for_fresh_entry(self) -> None:
        """is_expired returns False for recently accessed entries."""
        mock_device = MagicMock()
        cached = CachedSOFAModel(
            model=MagicMock(),
            g2p=MagicMock(),
            device=mock_device,
            checkpoint_path=Path("/fake/ckpt"),
            dictionary_path=Path("/fake/dict"),
        )
        # Just created, should not be expired
        assert cached.is_expired() is False

    def test_is_expired_returns_true_for_old_entry(self) -> None:
        """is_expired returns True for entries older than TTL."""
        mock_device = MagicMock()
        # Set last_accessed to well beyond TTL
        old_time = time.time() - MODEL_CACHE_TTL_SECONDS - 100
        cached = CachedSOFAModel(
            model=MagicMock(),
            g2p=MagicMock(),
            device=mock_device,
            checkpoint_path=Path("/fake/ckpt"),
            dictionary_path=Path("/fake/dict"),
            last_accessed=old_time,
        )
        assert cached.is_expired() is True

    def test_is_expired_custom_ttl(self) -> None:
        """is_expired respects custom TTL parameter."""
        mock_device = MagicMock()
        # 10 seconds old entry
        old_time = time.time() - 10
        cached = CachedSOFAModel(
            model=MagicMock(),
            g2p=MagicMock(),
            device=mock_device,
            checkpoint_path=Path("/fake/ckpt"),
            dictionary_path=Path("/fake/dict"),
            last_accessed=old_time,
        )
        # Not expired with 60s TTL
        assert cached.is_expired(ttl_seconds=60) is False
        # Expired with 5s TTL
        assert cached.is_expired(ttl_seconds=5) is True


class TestSOFAModelManager:
    """Tests for SOFAModelManager caching behavior."""

    def test_get_cache_key_unique_per_paths(self) -> None:
        """Cache keys are unique for different checkpoint/dictionary combinations."""
        manager = SOFAModelManager()

        key1 = manager._get_cache_key(Path("/ckpt1"), Path("/dict1"))
        key2 = manager._get_cache_key(Path("/ckpt2"), Path("/dict1"))
        key3 = manager._get_cache_key(Path("/ckpt1"), Path("/dict2"))

        assert key1 != key2
        assert key1 != key3
        assert key2 != key3

    def test_singleton_pattern(self) -> None:
        """SOFAModelManager uses singleton pattern."""
        manager1 = SOFAModelManager()
        manager2 = SOFAModelManager()
        assert manager1 is manager2

    def test_clear_cache_empties_cache(self) -> None:
        """clear_cache removes all cached models."""
        # Use the module function to ensure we're testing the global manager
        with patch("torch.cuda.is_available", return_value=False):
            manager = get_model_manager()
            # Manually add something to cache for testing
            manager._cache["test_key"] = MagicMock()
            assert len(manager._cache) > 0

            clear_sofa_model_cache()

            assert len(manager._cache) == 0


class TestSOFANativeMode:
    """Tests for native model loading mode."""

    def test_aligner_use_native_flag_default_true(self) -> None:
        """SOFAForcedAligner defaults to use_native=True."""
        aligner = SOFAForcedAligner()
        assert aligner._use_native is True

    def test_aligner_use_native_flag_can_be_disabled(self) -> None:
        """use_native can be set to False to force subprocess mode."""
        aligner = SOFAForcedAligner(use_native=False)
        assert aligner._use_native is False

    def test_get_sofa_aligner_use_native_parameter(self) -> None:
        """get_sofa_aligner passes use_native parameter."""
        aligner = get_sofa_aligner(use_native=False)
        assert aligner._use_native is False

        aligner = get_sofa_aligner(use_native=True)
        assert aligner._use_native is True

    @pytest.mark.asyncio
    async def test_align_falls_back_to_subprocess_on_native_failure(self) -> None:
        """align() falls back to subprocess when native mode fails."""
        aligner = SOFAForcedAligner(use_native=True)

        mock_result = AlignmentResult(
            segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
            audio_duration_ms=250.0,
            method="sofa",
        )

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_infer_native", side_effect=RuntimeError("Native failed")), \
             patch.object(aligner, "_infer_subprocess", new_callable=AsyncMock, return_value=mock_result) as mock_subprocess:

            result = await aligner.align(Path("/test/audio.wav"), "ka", "ja")

            # Should have fallen back to subprocess
            mock_subprocess.assert_called_once()
            assert result.method == "sofa"

    @pytest.mark.asyncio
    async def test_align_uses_subprocess_when_native_disabled(self) -> None:
        """align() uses subprocess directly when use_native=False."""
        aligner = SOFAForcedAligner(use_native=False)

        mock_result = AlignmentResult(
            segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
            audio_duration_ms=250.0,
            method="sofa",
        )

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_infer_native", new_callable=AsyncMock) as mock_native, \
             patch.object(aligner, "_infer_subprocess", new_callable=AsyncMock, return_value=mock_result):

            await aligner.align(Path("/test/audio.wav"), "ka", "ja")

            # Native should not have been called
            mock_native.assert_not_called()

    @pytest.mark.asyncio
    async def test_batch_align_native_processes_sequentially(self) -> None:
        """batch_align in native mode processes files sequentially with cached model."""
        aligner = SOFAForcedAligner(use_native=True)

        audio_paths = [Path(f"/test/audio_{i}.wav") for i in range(3)]
        items = [(p, "ka") for p in audio_paths]

        call_count = 0

        async def mock_infer_native(_audio_path, _transcript, _language):
            nonlocal call_count
            call_count += 1
            return AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            )

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_infer_native", side_effect=mock_infer_native):

            result = await aligner.batch_align(items, language="ja")

            # All 3 files processed
            assert len(result) == 3
            assert call_count == 3

    @pytest.mark.asyncio
    async def test_batch_align_native_partial_failure(self) -> None:
        """batch_align in native mode handles partial failures."""
        aligner = SOFAForcedAligner(use_native=True)

        audio_paths = [Path(f"/test/audio_{i}.wav") for i in range(3)]
        items = [(p, "ka") for p in audio_paths]

        async def mock_infer_native(audio_path, _transcript, _language):
            if "audio_1" in str(audio_path):
                raise RuntimeError("Failed for audio_1")
            return AlignmentResult(
                segments=[PhonemeSegment(phoneme="k", start_ms=20.0, end_ms=60.0, confidence=1.0)],
                audio_duration_ms=250.0,
                method="sofa",
            )

        with patch.object(aligner, "is_available", return_value=True), \
             patch.object(aligner, "_infer_native", side_effect=mock_infer_native):

            result = await aligner.batch_align(items, language="ja")

            # 2 out of 3 should succeed
            assert len(result) == 2
            assert audio_paths[0] in result
            assert audio_paths[1] not in result  # Failed
            assert audio_paths[2] in result


class TestSOFAModelCacheTTL:
    """Tests for model cache TTL behavior."""

    def test_model_cache_ttl_is_60_minutes(self) -> None:
        """MODEL_CACHE_TTL_SECONDS defaults to 60 minutes (3600 seconds).

        The TTL was increased from 5 minutes to 60 minutes to prevent
        unnecessary model reloads during batch processing jobs.
        Configurable via SOFA_CACHE_TTL_SECONDS environment variable.
        """
        assert MODEL_CACHE_TTL_SECONDS == 3600
