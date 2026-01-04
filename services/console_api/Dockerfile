# services/console_api/Dockerfile

FROM python:3.12-slim

WORKDIR /app

# Systempakete (optional: gcc, libpq wenn nötig)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV DB_HOST=db
ENV DB_PORT=5432
ENV DB_NAME=energy
ENV DB_USER=energy
ENV DB_PASSWORD=energy

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]

