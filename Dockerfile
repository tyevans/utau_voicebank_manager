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
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy Python project files
COPY pyproject.toml ./
COPY uv.lock* ./

# Install Python dependencies
# Use CPU-only torch to reduce image size (remove index-url for GPU support)
RUN uv sync --frozen --no-dev \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple

# Copy application source
COPY src/ ./src/

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./src/frontend/dist

# Create directories for runtime data
RUN mkdir -p /app/models /app/data/voicebanks

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV UV_SYSTEM_PYTHON=1

# Expose port 8989
EXPOSE 8989

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8989/health || exit 1

# Run FastAPI with uvicorn on port 8989
CMD ["uv", "run", "uvicorn", "src.backend.main:app", "--host", "0.0.0.0", "--port", "8989"]
