#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "run_router: start"

if service_exists "console_api" && service_running "console_api"; then
  exec_if_running "console_api" 'curl -fsS http://localhost:8000/jobs/run_router >/dev/null'
  log "run_router: done (console_api trigger)"
  exit 0
fi

if service_exists "router_agent" && service_running "router_agent"; then
  exec_if_running "router_agent" 'echo "TODO: implement router_agent trigger here"'
  log "run_router: done (router_agent placeholder)"
  exit 0
fi

log "WARN: no router trigger configured (console_api/router_agent not running)"

