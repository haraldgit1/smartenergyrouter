#!/usr/bin/env bash
set -euo pipefail
source /home/ella/SmartEnergyRouter/ops/cron/_common.sh

log "db_backup_energy: start"

if ! service_exists "timescaledb"; then
  log "ERROR: compose service 'timescaledb' not found"
  exit 1
fi
if ! service_running "timescaledb"; then
  log "ERROR: timescaledb not running"
  exit 1
fi

TS="$(date +%Y%m%d_%H%M%S)"
FILE="energy_${TS}.backup"

# 1) Dump in container
log "dump -> /tmp/${FILE} (container)"
exec_if_running "timescaledb" "pg_dump -U postgres -d energy -Fc -f /tmp/${FILE}"

# 2) Copy to host
CID="$(docker compose ps -q timescaledb)"
log "copy -> ${BACKUP_DIR}/${FILE}"
docker cp "${CID}:/tmp/${FILE}" "${BACKUP_DIR}/${FILE}"

# 3) Checksum
log "sha256 -> ${FILE}.sha256"
sha256sum "${BACKUP_DIR}/${FILE}" > "${BACKUP_DIR}/${FILE}.sha256"

# 4) Inventory list (so we can later verify/inspect without restore)
# Use a tool-container with a newer pg_restore, because you already hit version mismatches once.
log "inventory -> ${FILE}.list (pg_restore -l)"
docker run --rm \
  -v "${BACKUP_DIR}":/out \
  postgres:17 \
  bash -lc "pg_restore -l /out/${FILE} > /out/${FILE}.list"

# 5) Optional: sanity info
log "latest backup: ${BACKUP_DIR}/${FILE}"
log "db_backup_energy: done"

