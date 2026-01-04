#!/bin/bash
# Sicheres Backup des energy-DB
# Ausgabe: /home/ubuntu/backups/energy_YYYY-MM-DD_HHMM.dump

# Backup-Zielverzeichnis
BACKUP_DIR="/home/ubuntu/backups"

# Falls Ordner nicht existiert, anlegen
mkdir -p "$BACKUP_DIR"

# Zeitstempel
TS=$(date +"%Y-%m-%d_%H%M")

# Dateiname
FILE="$BACKUP_DIR/energy_${TS}.dump"

# Dump ausführen
docker compose exec -T timescaledb \
    pg_dump -U postgres -Fc -d energy > "$FILE"

# Optional: erfolgreiche Sicherung ausgeben
echo "Backup erstellt: $FILE"

