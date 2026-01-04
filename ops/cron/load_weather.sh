#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "load_weather: start"

if service_exists "console_api" && service_running "console_api"; then
  exec_if_running "console_api" 'curl -fsS http://localhost:8000/jobs/load_weather >/dev/null'
  log "load_weather: done (console_api)"
else
  log "WARN: console_api not running; adjust this script to your actual weather-loader"
fi

