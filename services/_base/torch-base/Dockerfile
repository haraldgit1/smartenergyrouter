FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /opt

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Torch CPU once
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip && \
    pip install --extra-index-url https://download.pytorch.org/whl/cpu torch==2.3.1

# optional: add common deps that rarely change
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install numpy==2.1.1 pandas==2.2.3

CMD ["python","-c","import torch, numpy, pandas; print('torch-base ok')"]

