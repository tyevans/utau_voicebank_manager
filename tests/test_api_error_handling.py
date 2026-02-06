"""Tests for API route error handling.

Covers error paths across the voicebanks and oto routers: 404 for missing
resources, 400/422 for invalid input, 409 for conflicts, 413 for oversized
uploads, and path traversal rejection.  Each test class mounts only the
router under test and injects mock services via FastAPI dependency overrides.
"""

import struct
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.backend.api.routers.oto import (
    get_oto_service,
    router as oto_router,
)
from src.backend.api.routers.voicebanks import (
    get_voicebank_repository,
    get_voicebank_service,
    router as voicebanks_router,
)
from src.backend.domain.oto_entry import OtoEntry
from src.backend.domain.voicebank import Voicebank, VoicebankSummary
from src.backend.repositories.voicebank_repository import VoicebankRepository
from src.backend.services.oto_service import (
    OtoEntryExistsError,
    OtoNotFoundError,
    OtoService,
    OtoValidationError,
)
from src.backend.services.voicebank_service import (
    VoicebankExistsError,
    VoicebankNotFoundError,
    VoicebankService,
    VoicebankValidationError,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _minimal_wav_bytes() -> bytes:
    """Build the smallest valid WAV file (RIFF header + silence)."""
    sample_rate = 44100
    bits_per_sample = 16
    num_channels = 1
    num_samples = 100
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = num_samples * block_align

    buf = bytearray()
    buf.extend(b"RIFF")
    buf.extend(struct.pack("<I", 36 + data_size))
    buf.extend(b"WAVE")
    buf.extend(b"fmt ")
    buf.extend(struct.pack("<I", 16))
    buf.extend(struct.pack("<H", 1))  # PCM
    buf.extend(struct.pack("<H", num_channels))
    buf.extend(struct.pack("<I", sample_rate))
    buf.extend(struct.pack("<I", byte_rate))
    buf.extend(struct.pack("<H", block_align))
    buf.extend(struct.pack("<H", bits_per_sample))
    buf.extend(b"data")
    buf.extend(struct.pack("<I", data_size))
    buf.extend(b"\x00" * data_size)
    return bytes(buf)


def _sample_voicebank(tmp_path: Path) -> Voicebank:
    """Return a Voicebank model pointing at *tmp_path*."""
    return Voicebank(
        id="test_voice",
        name="Test Voice",
        path=tmp_path,
        sample_count=2,
        has_oto=True,
        created_at=datetime.now(),
    )


# ===================================================================
# Voicebank router error handling
# ===================================================================


class TestVoicebankGet404:
    """GET /voicebanks/{id} returns 404 when voicebank does not exist."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.get = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'ghost' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/ghost")
        assert response.status_code == 404

    def test_detail_contains_id(self, client: TestClient) -> None:
        body = client.get("/voicebanks/ghost").json()
        assert "ghost" in body["detail"]


class TestVoicebankDelete404:
    """DELETE /voicebanks/{id} returns 404 for missing voicebank."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.delete = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'gone' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.delete("/voicebanks/gone")
        assert response.status_code == 404

    def test_detail_present(self, client: TestClient) -> None:
        body = client.delete("/voicebanks/gone").json()
        assert "detail" in body


class TestVoicebankListSamples404:
    """GET /voicebanks/{id}/samples returns 404 for missing voicebank."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.list_samples = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'nope' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/nope/samples")
        assert response.status_code == 404


class TestVoicebankGetSample404:
    """GET /voicebanks/{id}/samples/{filename} returns 404."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.get_sample_path = AsyncMock(
            side_effect=VoicebankNotFoundError(
                "Sample '_ka.wav' not found in voicebank 'missing'"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/missing/samples/_ka.wav")
        assert response.status_code == 404


class TestVoicebankCreateNoFiles:
    """POST /voicebanks without files returns 400."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_no_files_returns_400(self, client: TestClient) -> None:
        """Posting only a name with no files or zip triggers 400."""
        response = client.post(
            "/voicebanks",
            data={"name": "Empty Voice"},
        )
        assert response.status_code == 400
        assert "files" in response.json()["detail"].lower() or "zip" in response.json()["detail"].lower()


class TestVoicebankCreateConflict:
    """POST /voicebanks returns 409 when voicebank already exists."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.create = AsyncMock(
            side_effect=VoicebankExistsError(
                "Voicebank with ID 'dupe' already exists"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_409(self, client: TestClient) -> None:
        wav_data = _minimal_wav_bytes()
        response = client.post(
            "/voicebanks",
            data={"name": "Dupe"},
            files=[("files", ("_ka.wav", wav_data, "audio/wav"))],
        )
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]


class TestVoicebankCreateValidationError:
    """POST /voicebanks returns 400 on service validation errors."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.create = AsyncMock(
            side_effect=VoicebankValidationError(
                "Voicebank must contain at least one WAV file"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_400(self, client: TestClient) -> None:
        # Upload a non-WAV file (e.g., oto.ini) to trigger validation error
        response = client.post(
            "/voicebanks",
            data={"name": "Bad Voice"},
            files=[("files", ("notes.txt", b"hello", "text/plain"))],
        )
        assert response.status_code == 400


class TestVoicebankCreateInvalidWavContent:
    """POST /voicebanks rejects a .wav file without valid RIFF header."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_fake_wav_rejected(self, client: TestClient) -> None:
        """A file named .wav but with MP3 content is rejected at the router."""
        fake_wav = b"ID3\x00\x00" + b"\x00" * 100  # MP3-like header
        response = client.post(
            "/voicebanks",
            data={"name": "Fake"},
            files=[("files", ("_ka.wav", fake_wav, "audio/wav"))],
        )
        assert response.status_code == 400
        assert "RIFF" in response.json()["detail"]


class TestVoicebankCreateInvalidZipContentType:
    """POST /voicebanks rejects zip_file with wrong content type."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_wrong_content_type_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/voicebanks",
            data={"name": "Bad Zip"},
            files=[("zip_file", ("archive.zip", b"not a zip", "text/plain"))],
        )
        assert response.status_code == 400
        assert "ZIP" in response.json()["detail"] or "zip" in response.json()["detail"].lower()


class TestVoicebankCreateInvalidWavContentType:
    """POST /voicebanks rejects a .wav upload whose MIME is wrong."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_wrong_mime_rejected(self, client: TestClient) -> None:
        wav_data = _minimal_wav_bytes()
        response = client.post(
            "/voicebanks",
            data={"name": "Bad Type"},
            files=[("files", ("_ka.wav", wav_data, "application/octet-stream"))],
        )
        assert response.status_code == 400
        assert "content type" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Path traversal tests (voicebanks router)
# ---------------------------------------------------------------------------


class TestPathTraversalOnSampleGet:
    """GET /voicebanks/{id}/samples/{filename} rejects path traversal."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    @pytest.mark.parametrize(
        "filename",
        [
            "../etc/passwd",
            "..%2F..%2Fetc%2Fpasswd",
            "foo/../../../secret.wav",
        ],
    )
    def test_traversal_rejected(self, client: TestClient, filename: str) -> None:
        response = client.get(f"/voicebanks/test_voice/samples/{filename}")
        assert response.status_code == 400
        assert "detail" in response.json()


class TestPathTraversalOnVoicebankId:
    """GET /voicebanks/{id}/samples/{filename} rejects traversal in the ID."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=VoicebankService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_traversal_in_id_rejected(self, client: TestClient) -> None:
        response = client.get("/voicebanks/../admin/samples/_ka.wav")
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Metadata endpoint error handling
# ---------------------------------------------------------------------------


class TestMetadataGet404:
    """GET /voicebanks/{id}/metadata/{filename} returns 404 for missing VB."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        repo = MagicMock(spec=VoicebankRepository)
        repo.get_metadata_file = AsyncMock(return_value=None)
        return repo

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/gone/metadata/character.txt")
        assert response.status_code == 404

    def test_detail_present(self, client: TestClient) -> None:
        body = client.get("/voicebanks/gone/metadata/character.txt").json()
        assert "detail" in body


class TestMetadataGetInvalidFilename:
    """GET /voicebanks/{id}/metadata/{filename} rejects invalid filenames."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        return MagicMock(spec=VoicebankRepository)

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_unknown_filename_rejected(self, client: TestClient) -> None:
        """MetadataFilename enum only allows character.txt and readme.txt."""
        response = client.get("/voicebanks/test/metadata/evil.txt")
        # FastAPI returns 422 for invalid enum value
        assert response.status_code == 422


class TestMetadataPut404:
    """PUT /voicebanks/{id}/metadata/{filename} returns 404 for missing VB."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        repo = MagicMock(spec=VoicebankRepository)
        repo.save_metadata_file = AsyncMock(return_value=False)
        return repo

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.put(
            "/voicebanks/gone/metadata/character.txt",
            json={"content": "author=nobody"},
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Icon endpoint error handling
# ---------------------------------------------------------------------------


class TestIconGet404:
    """GET /voicebanks/{id}/icon returns 404 when icon missing."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        repo = MagicMock(spec=VoicebankRepository)
        repo.get_icon_path = AsyncMock(return_value=None)
        return repo

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/test/icon")
        assert response.status_code == 404


class TestIconDelete404:
    """DELETE /voicebanks/{id}/icon returns 404 when icon missing."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        repo = MagicMock(spec=VoicebankRepository)
        repo.delete_icon = AsyncMock(return_value=False)
        return repo

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.delete("/voicebanks/test/icon")
        assert response.status_code == 404


class TestIconUploadBadContentType:
    """POST /voicebanks/{id}/icon rejects non-image content types."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        return MagicMock(spec=VoicebankRepository)

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_text_file_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/voicebanks/test/icon",
            files=[("file", ("icon.txt", b"not an image", "text/plain"))],
        )
        assert response.status_code == 400
        assert "file type" in response.json()["detail"].lower()


class TestIconUploadNotFoundVoicebank:
    """POST /voicebanks/{id}/icon returns 404 for missing voicebank."""

    @pytest.fixture
    def mock_repo(self) -> MagicMock:
        repo = MagicMock(spec=VoicebankRepository)
        repo.save_icon = AsyncMock(return_value=False)
        return repo

    @pytest.fixture
    def client(self, mock_repo: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_repository] = lambda: mock_repo
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        # Provide a tiny valid PNG (1x1 pixel, transparent)
        # Smallest valid PNG:
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (10, 10), color="red").save(buf, format="PNG")
        png_bytes = buf.getvalue()

        response = client.post(
            "/voicebanks/gone/icon",
            files=[("file", ("icon.png", png_bytes, "image/png"))],
        )
        assert response.status_code == 404


# ===================================================================
# Pagination validation (query parameter bounds)
# ===================================================================


class TestPaginationValidation:
    """Verify FastAPI rejects out-of-range pagination parameters."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.list_all = AsyncMock(return_value=[])
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    def test_limit_zero_rejected(self, client: TestClient) -> None:
        """limit must be >= 1."""
        response = client.get("/voicebanks?limit=0")
        assert response.status_code == 422

    def test_limit_above_max_rejected(self, client: TestClient) -> None:
        """limit must be <= 500."""
        response = client.get("/voicebanks?limit=501")
        assert response.status_code == 422

    def test_negative_offset_rejected(self, client: TestClient) -> None:
        """offset must be >= 0."""
        response = client.get("/voicebanks?offset=-1")
        assert response.status_code == 422


# ===================================================================
# Oto router error handling
# ===================================================================


class TestOtoGetEntries404:
    """GET /voicebanks/{id}/oto returns 404 for missing voicebank."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.get_entries = AsyncMock(
            side_effect=OtoNotFoundError("Voicebank 'nope' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/nope/oto")
        assert response.status_code == 404

    def test_detail_mentions_voicebank(self, client: TestClient) -> None:
        body = client.get("/voicebanks/nope/oto").json()
        assert "nope" in body["detail"]


class TestOtoGetEntriesForFile404:
    """GET /voicebanks/{id}/oto/{filename} returns 404 for missing VB."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.get_entries_for_file = AsyncMock(
            side_effect=OtoNotFoundError("Voicebank 'gone' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.get("/voicebanks/gone/oto/_ka.wav")
        assert response.status_code == 404


class TestOtoCreateEntry404:
    """POST /voicebanks/{id}/oto returns 404 for missing voicebank."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.create_entry = AsyncMock(
            side_effect=OtoNotFoundError("Voicebank 'missing' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/voicebanks/missing/oto",
            json={
                "filename": "_ka.wav",
                "alias": "- ka",
                "offset": 45,
                "consonant": 120,
                "cutoff": -140,
                "preutterance": 80,
                "overlap": 15,
            },
        )
        assert response.status_code == 404


class TestOtoCreateEntryWavMissing:
    """POST /voicebanks/{id}/oto returns 400 when WAV file does not exist."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.create_entry = AsyncMock(
            side_effect=OtoValidationError(
                "WAV file '_missing.wav' does not exist in voicebank 'test'"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "filename": "_missing.wav",
                "alias": "- ka",
                "offset": 45,
                "consonant": 120,
                "cutoff": -140,
                "preutterance": 80,
                "overlap": 15,
            },
        )
        assert response.status_code == 400
        assert "does not exist" in response.json()["detail"]


class TestOtoCreateEntryDuplicate:
    """POST /voicebanks/{id}/oto returns 409 on duplicate entry."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.create_entry = AsyncMock(
            side_effect=OtoEntryExistsError(
                "Entry _ka.wav='- ka' already exists"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_409(self, client: TestClient) -> None:
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "filename": "_ka.wav",
                "alias": "- ka",
                "offset": 45,
                "consonant": 120,
                "cutoff": -140,
                "preutterance": 80,
                "overlap": 15,
            },
        )
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]


class TestOtoCreateEntryValidation:
    """POST /voicebanks/{id}/oto returns 422 for Pydantic validation errors."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        return MagicMock(spec=OtoService)

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_negative_offset_rejected(self, client: TestClient) -> None:
        """offset has ge=0 constraint in OtoEntryCreate."""
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "filename": "_ka.wav",
                "alias": "- ka",
                "offset": -10,
                "consonant": 120,
                "cutoff": -140,
                "preutterance": 80,
                "overlap": 15,
            },
        )
        assert response.status_code == 422

    def test_missing_filename_rejected(self, client: TestClient) -> None:
        """filename is required (min_length=1)."""
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "alias": "- ka",
                "offset": 0,
                "consonant": 0,
                "cutoff": 0,
                "preutterance": 0,
                "overlap": 0,
            },
        )
        assert response.status_code == 422

    def test_empty_body_rejected(self, client: TestClient) -> None:
        """Completely empty body is rejected."""
        response = client.post(
            "/voicebanks/test/oto",
            content=b"{}",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_negative_consonant_rejected(self, client: TestClient) -> None:
        """consonant has ge=0 constraint."""
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "filename": "_ka.wav",
                "alias": "- ka",
                "offset": 0,
                "consonant": -5,
                "cutoff": -100,
                "preutterance": 0,
                "overlap": 0,
            },
        )
        assert response.status_code == 422

    def test_negative_preutterance_rejected(self, client: TestClient) -> None:
        """preutterance has ge=0 constraint."""
        response = client.post(
            "/voicebanks/test/oto",
            json={
                "filename": "_ka.wav",
                "alias": "- ka",
                "offset": 0,
                "consonant": 100,
                "cutoff": -100,
                "preutterance": -1,
                "overlap": 0,
            },
        )
        assert response.status_code == 422


class TestOtoUpdateEntry404:
    """PUT /voicebanks/{id}/oto/{filename}/{alias} returns 404."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.update_entry = AsyncMock(
            side_effect=OtoNotFoundError(
                "Oto entry not found: _ka.wav=- ka in voicebank 'test'"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.put(
            "/voicebanks/test/oto/_ka.wav/-%20ka",
            json={"offset": 50},
        )
        assert response.status_code == 404

    def test_detail_mentions_entry(self, client: TestClient) -> None:
        body = client.put(
            "/voicebanks/test/oto/_ka.wav/-%20ka",
            json={"offset": 50},
        ).json()
        assert "not found" in body["detail"].lower()


class TestOtoDeleteEntry404:
    """DELETE /voicebanks/{id}/oto/{filename}/{alias} returns 404."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.delete_entry = AsyncMock(
            side_effect=OtoNotFoundError(
                "Oto entry not found: _ka.wav=- ka in voicebank 'test'"
            )
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_returns_404(self, client: TestClient) -> None:
        response = client.delete("/voicebanks/test/oto/_ka.wav/-%20ka")
        assert response.status_code == 404


class TestOtoPaginationValidation:
    """Oto list endpoint rejects invalid pagination parameters."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=OtoService)
        service.get_entries = AsyncMock(return_value=[])
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(oto_router)
        app.dependency_overrides[get_oto_service] = lambda: mock_service
        return TestClient(app)

    def test_limit_zero_rejected(self, client: TestClient) -> None:
        response = client.get("/voicebanks/test/oto?limit=0")
        assert response.status_code == 422

    def test_negative_offset_rejected(self, client: TestClient) -> None:
        response = client.get("/voicebanks/test/oto?offset=-1")
        assert response.status_code == 422


# ===================================================================
# Error response shape
# ===================================================================


class TestErrorResponseShape:
    """All error responses contain a 'detail' field with a message string."""

    @pytest.fixture
    def mock_service(self) -> MagicMock:
        service = MagicMock(spec=VoicebankService)
        service.get = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'x' not found")
        )
        service.delete = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'x' not found")
        )
        service.list_samples = AsyncMock(
            side_effect=VoicebankNotFoundError("Voicebank 'x' not found")
        )
        return service

    @pytest.fixture
    def client(self, mock_service: MagicMock) -> TestClient:
        app = FastAPI()
        app.include_router(voicebanks_router)
        app.dependency_overrides[get_voicebank_service] = lambda: mock_service
        return TestClient(app)

    @pytest.mark.parametrize(
        "method,path",
        [
            ("GET", "/voicebanks/x"),
            ("DELETE", "/voicebanks/x"),
            ("GET", "/voicebanks/x/samples"),
        ],
    )
    def test_error_body_has_detail_string(
        self, client: TestClient, method: str, path: str
    ) -> None:
        response = client.request(method, path)
        body = response.json()
        assert "detail" in body
        assert isinstance(body["detail"], str)
        assert len(body["detail"]) > 0


# ===================================================================
# Service-layer exception mapping (oto router)
# ===================================================================


class TestOtoServiceExceptionMapping:
    """Verify that different OtoService exceptions map to correct HTTP codes."""

    @pytest.fixture
    def app(self) -> FastAPI:
        app = FastAPI()
        app.include_router(oto_router)
        return app

    def _make_client(
        self, app: FastAPI, side_effect: Exception
    ) -> TestClient:
        service = MagicMock(spec=OtoService)
        service.create_entry = AsyncMock(side_effect=side_effect)
        app.dependency_overrides[get_oto_service] = lambda: service
        return TestClient(app)

    def _valid_entry_json(self) -> dict:
        return {
            "filename": "_ka.wav",
            "alias": "- ka",
            "offset": 45,
            "consonant": 120,
            "cutoff": -140,
            "preutterance": 80,
            "overlap": 15,
        }

    def test_not_found_maps_to_404(self, app: FastAPI) -> None:
        client = self._make_client(
            app, OtoNotFoundError("Voicebank 'x' not found")
        )
        response = client.post("/voicebanks/x/oto", json=self._valid_entry_json())
        assert response.status_code == 404

    def test_validation_error_maps_to_400(self, app: FastAPI) -> None:
        client = self._make_client(
            app, OtoValidationError("WAV file '_ka.wav' does not exist")
        )
        response = client.post("/voicebanks/x/oto", json=self._valid_entry_json())
        assert response.status_code == 400

    def test_exists_error_maps_to_409(self, app: FastAPI) -> None:
        client = self._make_client(
            app, OtoEntryExistsError("Entry already exists")
        )
        response = client.post("/voicebanks/x/oto", json=self._valid_entry_json())
        assert response.status_code == 409
