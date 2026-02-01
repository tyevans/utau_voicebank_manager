"""FastAPI application entry point for UTAU Voicebank Manager."""

import logging

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

app = FastAPI(
    title="UTAU Voicebank Manager",
    description="AI-assisted voicebank creation platform for UTAU/OpenUTAU singing synthesizers",
    version="0.1.0",
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
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
