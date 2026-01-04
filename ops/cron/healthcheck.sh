#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "healthcheck: start"

if ! compose_ok; then
  log "ERROR: docker compose not available"
  exit 1
fi

# Basic: list running containers of this compose project
docker compose ps

# DB readiness check if timescaledb exists
if service_exists "timescaledb" && service_running "timescaledb"; then
  exec_if_running "timescaledb" 'pg_isready -U postgres || true'
  exec_if_running "timescaledb" 'psql -U postgres -d energy -tAc "SELECT 1" || true'
else
  log "WARN: timescaledb not running"
fi

# Optional: RabbitMQ health (if service exists)
if service_exists "rabbitmq" && service_running "rabbitmq"; then
  exec_if_running "rabbitmq" 'rabbitmq-diagnostics -q ping || true'
fi

log "healthcheck: done"

