"""Tests for the voicebank download endpoint.

Tests the GET /api/v1/voicebanks/{voicebank_id}/download endpoint which
returns a ZIP file containing WAV samples and oto.ini configuration.
"""

import io
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.backend.api.routers.voicebank_download import (
    create_voicebank_zip,
    get_oto_repository,
    get_voicebank_repository,
    get_voicebank_service,
    router,
)
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.voicebank import Voicebank
from src.backend.repositories.oto_repository import OtoRepository
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.voicebank_service import VoicebankNotFoundError, VoicebankService


class TestVoicebankDownloadEndpoint:
    """Tests for the voicebank download API endpoint."""

    @pytest.fixture
    def app(self) -> FastAPI:
        """Create FastAPI app with download router."""
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        return app

    @pytest.fixture
    def voicebank_dir(self, tmp_path: Path) -> Path:
        """Create a temporary voicebank directory with WAV files."""
        vb_dir = tmp_path / "test_voice"
        vb_dir.mkdir()

        # Create sample WAV files (minimal valid WAV headers)
        wav_header = self._create_minimal_wav()
        (vb_dir / "_ka.wav").write_bytes(wav_header)
        (vb_dir / "_sa.wav").write_bytes(wav_header)
        (vb_dir / "_ta.wav").write_bytes(wav_header)

        return vb_dir

    @pytest.fixture
    def sample_oto_entries(self) -> list[OtoEntry]:
        """Create sample oto entries for testing."""
        return [
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            ),
            OtoEntry(
                filename="_sa.wav",
                alias="- sa",
                offset=50.0,
                consonant=100.0,
                cutoff=-120.0,
                preutterance=70.0,
                overlap=10.0,
            ),
        ]

    @pytest.fixture
    def sample_voicebank(self, voicebank_dir: Path) -> Voicebank:
        """Create a sample voicebank model."""
        from datetime import datetime

        return Voicebank(
            id="test_voice",
            name="Test Voice",
            path=voicebank_dir,
            sample_count=3,
            has_oto=True,
            created_at=datetime.now(),
        )

    @pytest.fixture
    def mock_voicebank_service(self, sample_voicebank: Voicebank) -> MagicMock:
        """Create mock voicebank service."""
        service = MagicMock(spec=VoicebankService)
        service.get = AsyncMock(return_value=sample_voicebank)
        return service

    @pytest.fixture
    def mock_oto_repository(self, sample_oto_entries: list[OtoEntry]) -> MagicMock:
        """Create mock oto repository."""
        repo = MagicMock(spec=OtoRepository)
        repo.get_entries = AsyncMock(return_value=sample_oto_entries)
        return repo

    @pytest.fixture
    def client(
        self,
        app: FastAPI,
        mock_voicebank_service: MagicMock,
        mock_oto_repository: MagicMock,
    ) -> TestClient:
        """Create test client with mocked dependencies."""
        app.dependency_overrides[get_voicebank_service] = lambda: mock_voicebank_service
        app.dependency_overrides[get_oto_repository] = lambda: mock_oto_repository
        return TestClient(app)

    def _create_minimal_wav(self) -> bytes:
        """Create a minimal valid WAV file header with silence."""
        import struct

        # WAV file parameters
        sample_rate = 44100
        bits_per_sample = 16
        num_channels = 1
        num_samples = 100  # Very short sample
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = num_samples * block_align

        # Build WAV header
        wav_data = bytearray()

        # RIFF header
        wav_data.extend(b"RIFF")
        wav_data.extend(struct.pack("<I", 36 + data_size))  # File size - 8
        wav_data.extend(b"WAVE")

        # fmt chunk
        wav_data.extend(b"fmt ")
        wav_data.extend(struct.pack("<I", 16))  # Chunk size
        wav_data.extend(struct.pack("<H", 1))  # Audio format (PCM)
        wav_data.extend(struct.pack("<H", num_channels))
        wav_data.extend(struct.pack("<I", sample_rate))
        wav_data.extend(struct.pack("<I", byte_rate))
        wav_data.extend(struct.pack("<H", block_align))
        wav_data.extend(struct.pack("<H", bits_per_sample))

        # data chunk
        wav_data.extend(b"data")
        wav_data.extend(struct.pack("<I", data_size))
        wav_data.extend(b"\x00" * data_size)  # Silence

        return bytes(wav_data)

    def test_download_returns_200_with_zip(
        self,
        client: TestClient,
        mock_voicebank_service: MagicMock,
    ) -> None:
        """Successful download returns 200 status code and ZIP content."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        assert response.status_code == 200
        mock_voicebank_service.get.assert_called_once_with("test_voice")

    def test_download_content_type_is_zip(
        self,
        client: TestClient,
    ) -> None:
        """Download response has application/zip content type."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        assert response.headers["content-type"] == "application/zip"

    def test_download_content_disposition_header(
        self,
        client: TestClient,
    ) -> None:
        """Download response has correct Content-Disposition header."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        assert "content-disposition" in response.headers
        content_disposition = response.headers["content-disposition"]
        assert 'attachment; filename="test_voice.zip"' == content_disposition

    def test_download_zip_contains_wav_files(
        self,
        client: TestClient,
        voicebank_dir: Path,
    ) -> None:
        """Downloaded ZIP contains the voicebank's WAV files."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        # Parse the ZIP content
        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            file_names = zf.namelist()

        assert "_ka.wav" in file_names
        assert "_sa.wav" in file_names
        assert "_ta.wav" in file_names

    def test_download_zip_contains_oto_ini(
        self,
        client: TestClient,
        sample_oto_entries: list[OtoEntry],
    ) -> None:
        """Downloaded ZIP contains oto.ini with correct entries."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            file_names = zf.namelist()
            assert "oto.ini" in file_names

            # Read and verify oto.ini content
            oto_content = zf.read("oto.ini").decode("utf-8")

        # Verify entries are in the oto.ini
        assert "_ka.wav=- ka,45,120,-140,80,15" in oto_content
        assert "_sa.wav=- sa,50,100,-120,70,10" in oto_content

    def test_download_returns_404_for_nonexistent_voicebank(
        self,
        app: FastAPI,
        mock_oto_repository: MagicMock,
    ) -> None:
        """Non-existent voicebank returns 404 Not Found."""
        # Create a service that raises VoicebankNotFoundError
        mock_service = MagicMock(spec=VoicebankService)
        mock_service.get = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'nonexistent' not found")
        )

        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        app.dependency_overrides[get_oto_repository] = lambda: mock_oto_repository

        client = TestClient(app)
        response = client.get("/api/v1/voicebanks/nonexistent/download")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_download_zip_without_oto_entries(
        self,
        app: FastAPI,
        mock_voicebank_service: MagicMock,
    ) -> None:
        """Voicebank without oto entries returns ZIP without oto.ini."""
        # Create oto repo that returns empty entries
        mock_oto_repo = MagicMock(spec=OtoRepository)
        mock_oto_repo.get_entries = AsyncMock(return_value=[])

        app.dependency_overrides[get_voicebank_service] = lambda: mock_voicebank_service
        app.dependency_overrides[get_oto_repository] = lambda: mock_oto_repo

        client = TestClient(app)
        response = client.get("/api/v1/voicebanks/test_voice/download")

        assert response.status_code == 200

        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            file_names = zf.namelist()

        # oto.ini should not be present when there are no entries
        assert "oto.ini" not in file_names

    def test_download_zip_is_valid(
        self,
        client: TestClient,
    ) -> None:
        """Downloaded content is a valid ZIP file."""
        response = client.get("/api/v1/voicebanks/test_voice/download")

        zip_buffer = io.BytesIO(response.content)
        # This will raise BadZipFile if invalid
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            # Test that we can read the file list
            assert zf.testzip() is None  # Returns None if all files are OK

    def test_download_wav_file_contents_match(
        self,
        client: TestClient,
        voicebank_dir: Path,
    ) -> None:
        """WAV files in ZIP match the original files."""
        # Read original file
        original_ka = (voicebank_dir / "_ka.wav").read_bytes()

        response = client.get("/api/v1/voicebanks/test_voice/download")

        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            zip_ka = zf.read("_ka.wav")

        assert zip_ka == original_ka


class TestCreateVoicebankZip:
    """Tests for the create_voicebank_zip generator function."""

    @pytest.fixture
    def voicebank_dir(self, tmp_path: Path) -> Path:
        """Create a temporary voicebank directory with files."""
        vb_dir = tmp_path / "test_voice"
        vb_dir.mkdir()

        # Create some WAV files with recognizable content
        (vb_dir / "_ka.wav").write_bytes(b"RIFF....WAVE_ka_content")
        (vb_dir / "_sa.wav").write_bytes(b"RIFF....WAVE_sa_content")

        return vb_dir

    @pytest.mark.asyncio
    async def test_zip_generator_yields_bytes(
        self,
        voicebank_dir: Path,
    ) -> None:
        """ZIP generator yields byte chunks."""
        oto_content = "_ka.wav=- ka,45,120,-140,80,15"

        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, oto_content):
            chunks.append(chunk)
            assert isinstance(chunk, bytes)

        # Should have yielded at least one chunk
        assert len(chunks) >= 1

    @pytest.mark.asyncio
    async def test_zip_generator_creates_valid_zip(
        self,
        voicebank_dir: Path,
    ) -> None:
        """Assembled chunks form a valid ZIP file."""
        oto_content = "_ka.wav=- ka,45,120,-140,80,15"

        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, oto_content):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            assert zf.testzip() is None

    @pytest.mark.asyncio
    async def test_zip_generator_includes_wav_files(
        self,
        voicebank_dir: Path,
    ) -> None:
        """ZIP includes all WAV files from the voicebank directory."""
        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, None):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            file_names = zf.namelist()

        assert "_ka.wav" in file_names
        assert "_sa.wav" in file_names

    @pytest.mark.asyncio
    async def test_zip_generator_includes_oto_when_provided(
        self,
        voicebank_dir: Path,
    ) -> None:
        """ZIP includes oto.ini when content is provided."""
        oto_content = "_ka.wav=- ka,45,120,-140,80,15\n_sa.wav=- sa,50,100,-120,70,10"

        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, oto_content):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            assert "oto.ini" in zf.namelist()
            oto_in_zip = zf.read("oto.ini").decode("utf-8")
            assert oto_in_zip == oto_content

    @pytest.mark.asyncio
    async def test_zip_generator_excludes_oto_when_none(
        self,
        voicebank_dir: Path,
    ) -> None:
        """ZIP excludes oto.ini when content is None."""
        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, None):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            assert "oto.ini" not in zf.namelist()

    @pytest.mark.asyncio
    async def test_zip_uses_deflate_compression(
        self,
        voicebank_dir: Path,
    ) -> None:
        """ZIP uses DEFLATE compression."""
        oto_content = "_ka.wav=- ka,45,120,-140,80,15"

        chunks = []
        async for chunk in create_voicebank_zip(voicebank_dir, oto_content):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            for info in zf.infolist():
                assert info.compress_type == zipfile.ZIP_DEFLATED

    @pytest.mark.asyncio
    async def test_zip_generator_empty_directory(
        self,
        tmp_path: Path,
    ) -> None:
        """ZIP generator handles empty directory."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()

        chunks = []
        async for chunk in create_voicebank_zip(empty_dir, None):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        zip_buffer = io.BytesIO(zip_data)

        with zipfile.ZipFile(zip_buffer, "r") as zf:
            assert zf.namelist() == []


class TestVoicebankDownloadIntegration:
    """Integration tests using real filesystem operations."""

    @pytest.fixture
    def integration_setup(self, tmp_path: Path) -> tuple[Path, list[OtoEntry]]:
        """Set up a complete voicebank directory for integration testing."""
        vb_base = tmp_path / "voicebanks"
        vb_base.mkdir()

        vb_dir = vb_base / "integration_voice"
        vb_dir.mkdir()

        # Create realistic WAV files
        import struct

        def create_wav(samples: int = 1000) -> bytes:
            sample_rate = 44100
            bits_per_sample = 16
            num_channels = 1
            byte_rate = sample_rate * num_channels * bits_per_sample // 8
            block_align = num_channels * bits_per_sample // 8
            data_size = samples * block_align

            wav_data = bytearray()
            wav_data.extend(b"RIFF")
            wav_data.extend(struct.pack("<I", 36 + data_size))
            wav_data.extend(b"WAVE")
            wav_data.extend(b"fmt ")
            wav_data.extend(struct.pack("<I", 16))
            wav_data.extend(struct.pack("<H", 1))
            wav_data.extend(struct.pack("<H", num_channels))
            wav_data.extend(struct.pack("<I", sample_rate))
            wav_data.extend(struct.pack("<I", byte_rate))
            wav_data.extend(struct.pack("<H", block_align))
            wav_data.extend(struct.pack("<H", bits_per_sample))
            wav_data.extend(b"data")
            wav_data.extend(struct.pack("<I", data_size))
            wav_data.extend(b"\x00" * data_size)
            return bytes(wav_data)

        # Create WAV files
        (vb_dir / "_a.wav").write_bytes(create_wav(500))
        (vb_dir / "_ka.wav").write_bytes(create_wav(600))
        (vb_dir / "_sa.wav").write_bytes(create_wav(550))

        oto_entries = [
            OtoEntry(
                filename="_a.wav",
                alias="- a",
                offset=10.0,
                consonant=50.0,
                cutoff=-80.0,
                preutterance=40.0,
                overlap=5.0,
            ),
            OtoEntry(
                filename="_ka.wav",
                alias="- ka",
                offset=45.0,
                consonant=120.0,
                cutoff=-140.0,
                preutterance=80.0,
                overlap=15.0,
            ),
            OtoEntry(
                filename="_sa.wav",
                alias="- sa",
                offset=50.0,
                consonant=100.0,
                cutoff=-120.0,
                preutterance=70.0,
                overlap=10.0,
            ),
        ]

        return vb_base, oto_entries

    def test_full_download_workflow(
        self,
        integration_setup: tuple[Path, list[OtoEntry]],
    ) -> None:
        """Test complete download workflow with real filesystem."""
        vb_base, oto_entries = integration_setup
        vb_dir = vb_base / "integration_voice"

        # Create real repositories
        from datetime import datetime

        voicebank_repo = VoicebankRepository(vb_base)
        oto_repo = OtoRepository(voicebank_repo)

        # Create voicebank model
        voicebank = Voicebank(
            id="integration_voice",
            name="Integration Voice",
            path=vb_dir,
            sample_count=3,
            has_oto=True,
            created_at=datetime.now(),
        )

        # Mock the service but use real repos
        mock_service = MagicMock(spec=VoicebankService)
        mock_service.get = AsyncMock(return_value=voicebank)

        mock_oto_repo = MagicMock(spec=OtoRepository)
        mock_oto_repo.get_entries = AsyncMock(return_value=oto_entries)

        # Create app with mocked dependencies
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        app.dependency_overrides[get_oto_repository] = lambda: mock_oto_repo

        client = TestClient(app)

        # Download the voicebank
        response = client.get("/api/v1/voicebanks/integration_voice/download")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"

        # Verify ZIP contents
        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            files = zf.namelist()

            # Check WAV files
            assert "_a.wav" in files
            assert "_ka.wav" in files
            assert "_sa.wav" in files

            # Check oto.ini
            assert "oto.ini" in files
            oto_content = zf.read("oto.ini").decode("utf-8")
            assert "_a.wav=- a,10,50,-80,40,5" in oto_content
            assert "_ka.wav=- ka,45,120,-140,80,15" in oto_content
            assert "_sa.wav=- sa,50,100,-120,70,10" in oto_content

            # Verify WAV files are valid
            for wav_file in ["_a.wav", "_ka.wav", "_sa.wav"]:
                wav_data = zf.read(wav_file)
                assert wav_data[:4] == b"RIFF"
                assert wav_data[8:12] == b"WAVE"

    def test_download_preserves_uppercase_wav_extension(
        self,
        tmp_path: Path,
    ) -> None:
        """Download includes files with uppercase .WAV extension."""
        vb_base = tmp_path / "voicebanks"
        vb_base.mkdir()
        vb_dir = vb_base / "uppercase_test"
        vb_dir.mkdir()

        # Create a file with uppercase extension
        wav_content = b"RIFF....WAVE_uppercase"
        (vb_dir / "_KA.WAV").write_bytes(wav_content)

        from datetime import datetime

        voicebank = Voicebank(
            id="uppercase_test",
            name="Uppercase Test",
            path=vb_dir,
            sample_count=1,
            has_oto=False,
            created_at=datetime.now(),
        )

        mock_service = MagicMock(spec=VoicebankService)
        mock_service.get = AsyncMock(return_value=voicebank)

        mock_oto_repo = MagicMock(spec=OtoRepository)
        mock_oto_repo.get_entries = AsyncMock(return_value=[])

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        app.dependency_overrides[get_oto_repository] = lambda: mock_oto_repo

        client = TestClient(app)
        response = client.get("/api/v1/voicebanks/uppercase_test/download")

        assert response.status_code == 200

        zip_buffer = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            assert "_KA.WAV" in zf.namelist()
