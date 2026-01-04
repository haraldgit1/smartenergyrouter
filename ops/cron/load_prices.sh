#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "load_prices: start"

# Try calling your console_api if it exists; otherwise, just log and exit OK.
if service_exists "console_api" && service_running "console_api"; then
  # Common pattern you used: console_api on port 8000 inside container.
  # Adjust endpoint if your API differs.
  exec_if_running "console_api" 'curl -fsS http://localhost:8000/jobs/load_prices >/dev/null'
  log "load_prices: done (console_api)"
else
  log "WARN: console_api not running; adjust this script to your actual price-loader"
fi

