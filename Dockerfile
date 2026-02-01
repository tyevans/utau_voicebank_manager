# Multi-stage Dockerfile for UTAU Voicebank Manager
# Runs both backend API and frontend on port 8989

# =============================================================================
# Stage 1: Build frontend
# =============================================================================
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY src/frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY src/frontend/ ./

# Build for production
RUN npm run build

# =============================================================================
# Stage 2: Python runtime with backend
# =============================================================================
FROM python:3.11-slim AS runtime

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng \
    libespeak-ng1 \
    libsndfile1 \
    ffmpeg \
    git \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Set Python environment variables early so pip and uv use the same location
ENV UV_SYSTEM_PYTHON=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Copy Python project files (README.md needed by hatchling build)
COPY pyproject.toml README.md ./
COPY uv.lock* ./

# Install CPU-only PyTorch first (uv's --index-url doesn't work correctly for torch)
# This avoids downloading ~2GB of CUDA libraries
# For GPU support: remove this step and just use uv sync
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
    torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies (torch already satisfied from above)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Copy application source
COPY src/ ./src/

# Clone SOFA (Singing-Oriented Forced Aligner) submodule
# Git submodules aren't included in Docker builds, so we clone directly
RUN git clone --depth 1 https://github.com/tyevans/SOFA.git vendor/SOFA

# Download SOFA checkpoint and dictionary files
# English: checkpoint ~387MB, dictionary ~3MB
# Japanese: zip ~1.1GB containing checkpoint and dictionary
RUN mkdir -p vendor/SOFA/ckpt vendor/SOFA/dictionary && \
    curl -L -o vendor/SOFA/ckpt/tgm_en_v100.ckpt \
        "https://github.com/spicytigermeat/SOFA-Models/releases/download/v1.0.0_en/tgm_en_v100.ckpt" && \
    curl -L -o vendor/SOFA/dictionary/english.txt \
        "https://github.com/spicytigermeat/SOFA-Models/releases/download/v0.0.5/tgm_sofa_dict.txt" && \
    curl -L -o /tmp/sofa_jpn.zip \
        "https://github.com/colstone/SOFA_Models/releases/download/JPN-V0.0.2b/SOFA_model_JPN_Ver0.0.2_Beta.zip" && \
    unzip -j /tmp/sofa_jpn.zip "*.ckpt" -d vendor/SOFA/ckpt/ && \
    unzip -j /tmp/sofa_jpn.zip "*.txt" -d vendor/SOFA/dictionary/ && \
    rm /tmp/sofa_jpn.zip

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./src/frontend/dist

# Create directories for runtime data
RUN mkdir -p /app/models /app/data/voicebanks

# Expose port 8989
EXPOSE 8989

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8989/health || exit 1

# Run FastAPI with uvicorn on port 8989
CMD ["uv", "run", "uvicorn", "src.backend.main:app", "--host", "0.0.0.0", "--port", "8989"]
