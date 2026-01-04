# services/predictor_tirex/Dockerfile
FROM ghcr.io/haraldgit1/smartenergyrouter/torch-base:py311-torch2.3.1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# deps layer (cache-friendly) - install only "light" deps
COPY requirements.txt .

# IMPORTANT:
# In requirements.txt you should REMOVE torch/numpy/pandas now
# because they are already provided by torch-base.
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip && \
    pip install -r requirements.txt

# app code
COPY main.py features.py model_tirex.py model_baseline.py ./

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

