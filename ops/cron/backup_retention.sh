#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

DAYS_KEEP="${DAYS_KEEP:-21}"

log "backup_retention: keep ${DAYS_KEEP} days in ${BACKUP_DIR}"

find "${BACKUP_DIR}" -type f -name "energy_*.backup" -mtime "+${DAYS_KEEP}" -print -delete || true
find "${BACKUP_DIR}" -type f -name "energy_*.sha256" -mtime "+${DAYS_KEEP}" -print -delete || true
find "${BACKUP_DIR}" -type f -name "energy_*.list"   -mtime "+${DAYS_KEEP}" -print -delete || true

log "backup_retention: done"

