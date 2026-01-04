#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "run_optimize: start"

if service_exists "console_api" && service_running "console_api"; then
  exec_if_running "console_api" 'curl -fsS http://localhost:8000/jobs/run_optimize >/dev/null'
  log "run_optimize: done (console_api trigger)"
  exit 0
fi

if service_exists "optimizer" && service_running "optimizer"; then
  exec_if_running "optimizer" 'echo "TODO: implement optimizer trigger here"'
  log "run_optimize: done (optimizer placeholder)"
  exit 0
fi

log "WARN: no optimize trigger configured (console_api/optimizer not running)"

