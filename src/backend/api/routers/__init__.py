"""API routers package."""

from fastapi import APIRouter

from src.backend.api.routers.ml import router as ml_router
from src.backend.api.routers.oto import router as oto_router
from src.backend.api.routers.recording_sessions import router as sessions_router
from src.backend.api.routers.voicebanks import router as voicebanks_router

api_router = APIRouter()

# Include ML router for phoneme detection
api_router.include_router(ml_router)

# Voicebank management router
api_router.include_router(voicebanks_router)

# Oto.ini entry management router
api_router.include_router(oto_router)

# Recording session management router
api_router.include_router(sessions_router)
