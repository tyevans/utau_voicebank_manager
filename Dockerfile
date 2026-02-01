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

# Clone SOFA (Singing-Oriented Forced Aligner) submodule
# Git submodules aren't included in Docker builds, so we clone directly
# Done BEFORE copying source so source changes don't invalidate this layer
RUN git clone --depth 1 https://github.com/tyevans/SOFA.git vendor/SOFA

# Install SOFA Python dependencies
# Note: torch/torchaudio already installed above, skip those
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
    click \
    einops==0.6.1 \
    h5py \
    "librosa<0.10.0" \
    "lightning>=2.0.0" \
    "matplotlib~=3.7.3" \
    textgrid \
    chardet

# Download SOFA checkpoint and dictionary files with caching
# English: checkpoint ~387MB, dictionary ~3MB
# Japanese: zip ~1.1GB containing checkpoint and dictionary
# Uses BuildKit cache mount to persist downloads across builds
RUN --mount=type=cache,target=/tmp/sofa-cache \
    mkdir -p vendor/SOFA/ckpt vendor/SOFA/dictionary && \
    # English checkpoint
    if [ ! -f /tmp/sofa-cache/tgm_en_v100.ckpt ]; then \
        curl -L -o /tmp/sofa-cache/tgm_en_v100.ckpt \
            "https://github.com/spicytigermeat/SOFA-Models/releases/download/v1.0.0_en/tgm_en_v100.ckpt"; \
    fi && \
    cp /tmp/sofa-cache/tgm_en_v100.ckpt vendor/SOFA/ckpt/ && \
    # English dictionary
    if [ ! -f /tmp/sofa-cache/english.txt ]; then \
        curl -L -o /tmp/sofa-cache/english.txt \
            "https://github.com/spicytigermeat/SOFA-Models/releases/download/v0.0.5/tgm_sofa_dict.txt"; \
    fi && \
    cp /tmp/sofa-cache/english.txt vendor/SOFA/dictionary/ && \
    # Japanese models (zip file)
    if [ ! -f /tmp/sofa-cache/sofa_jpn.zip ]; then \
        curl -L -o /tmp/sofa-cache/sofa_jpn.zip \
            "https://github.com/colstone/SOFA_Models/releases/download/JPN-V0.0.2b/SOFA_model_JPN_Ver0.0.2_Beta.zip"; \
    fi && \
    unzip -j /tmp/sofa-cache/sofa_jpn.zip "*.ckpt" -d vendor/SOFA/ckpt/ && \
    unzip -j /tmp/sofa-cache/sofa_jpn.zip "*.txt" -d vendor/SOFA/dictionary/ && \
    # Rename Japanese checkpoint to expected name (code looks for japanese.ckpt)
    find vendor/SOFA/ckpt -name "*.ckpt" ! -name "tgm_en_v100.ckpt" -exec mv {} vendor/SOFA/ckpt/japanese.ckpt \; && \
    # Rename Japanese dictionary to expected name (code looks for japanese.txt)
    find vendor/SOFA/dictionary -name "*.txt" ! -name "english.txt" -exec mv {} vendor/SOFA/dictionary/japanese.txt \;

# Copy application source (after downloads so source changes don't re-download)
COPY src/ ./src/

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
