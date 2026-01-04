#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "run_forecast: start"

# Option A: trigger via API
if service_exists "console_api" && service_running "console_api"; then
  exec_if_running "console_api" 'curl -fsS http://localhost:8000/jobs/run_forecast >/dev/null'
  log "run_forecast: done (console_api trigger)"
  exit 0
fi

# Option B: direct service trigger (if you have predictor service with a CLI/endpoint)
if service_exists "predictor" && service_running "predictor"; then
  exec_if_running "predictor" 'echo "TODO: implement predictor trigger here"'
  log "run_forecast: done (predictor placeholder)"
  exit 0
fi

log "WARN: no forecast trigger configured (console_api/predictor not running)"

