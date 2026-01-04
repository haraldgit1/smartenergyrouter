#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/ella/SmartEnergyRouter"
LOG_DIR="/var/log/smartenergyrouter"
BACKUP_DIR="${PROJECT_DIR}/backups/energy"

cd "$PROJECT_DIR"

mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Helper: log with timestamp
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Helper: returns 0 if docker compose is usable here
compose_ok() {
  docker compose version >/dev/null 2>&1
}

# Helper: returns 0 if service exists in compose config
service_exists() {
  local svc="$1"
  docker compose config --services 2>/dev/null | grep -qx "$svc"
}

# Helper: returns 0 if service is running
service_running() {
  local svc="$1"
  local cid
  cid="$(docker compose ps -q "$svc" 2>/dev/null || true)"
  [[ -n "$cid" ]] && docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null | grep -q true
}

# Helper: execute inside service if running; else warn
exec_if_running() {
  local svc="$1"; shift
  if service_running "$svc"; then
    docker compose exec -T "$svc" bash -lc "$*"
  else
    log "WARN: service '$svc' not running, skip command: $*"
    return 0
  fi
}

