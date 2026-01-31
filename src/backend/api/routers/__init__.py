"""API routers package."""

from fastapi import APIRouter

from src.backend.api.routers.ml import router as ml_router

api_router = APIRouter()

# Include ML router for phoneme detection
api_router.include_router(ml_router)

# Domain routers will be included here as they are created
# Example:
# from src.backend.api.routers.voicebanks import router as voicebanks_router
# api_router.include_router(voicebanks_router)
