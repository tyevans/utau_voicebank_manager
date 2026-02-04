"""FastAPI application entry point for UTAU Voicebank Manager."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

# Configure logging before importing modules
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

# Set DEBUG level for ML modules to see aligner selection
logging.getLogger("src.backend.ml").setLevel(logging.DEBUG)
logging.getLogger("src.backend.services").setLevel(logging.DEBUG)

# Configure eSpeak before importing ML modules (must be first)
from src.backend.utils.espeak_config import configure_espeak  # noqa: E402

configure_espeak()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.backend.api.routers import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: connect to Redis for job queue."""
    from arq.connections import RedisSettings, create_pool
    from redis.asyncio import Redis

    from src.backend.config import get_settings
    from src.backend.services.job_service import JobService

    settings = get_settings()
    _logger = logging.getLogger(__name__)

    redis = None
    arq_pool = None

    try:
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        await redis.ping()

        arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))

        app.state.redis = redis
        app.state.arq_pool = arq_pool
        app.state.job_service = JobService(redis, ttl_seconds=settings.job_ttl_seconds)

        _logger.info("Connected to Redis at %s", settings.redis_url)
    except Exception:
        _logger.warning(
            "Redis not available at %s — job queue disabled (local dev mode)",
            settings.redis_url,
        )
        app.state.redis = None
        app.state.arq_pool = None
        app.state.job_service = None

    yield

    # Cleanup
    if arq_pool is not None:
        await arq_pool.aclose()
    if redis is not None:
        await redis.aclose()


app = FastAPI(
    title="UTAU Voicebank Manager",
    description="AI-assisted voicebank creation platform for UTAU/OpenUTAU singing synthesizers",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for local development and Docker
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:8989",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


# Serve static frontend in production (when built files exist)
# NOTE: This must be LAST since it catches all unmatched routes
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    # Mount assets directory
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    # Serve vite.svg favicon
    @app.get("/vite.svg")
    async def serve_vite_svg():
        """Serve the Vite favicon."""
        return FileResponse(FRONTEND_DIST / "vite.svg")

    # SPA catch-all: serve index.html for all non-API routes
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        """Serve the frontend SPA for client-side routing."""
        # Check if it's a file in dist that exists
        file_path = FRONTEND_DIST / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        # Otherwise serve index.html for SPA routing
        return FileResponse(FRONTEND_DIST / "index.html")
