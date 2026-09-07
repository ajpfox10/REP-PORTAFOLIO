#!/bin/bash
# scripts/backup/restore.sh — Restaurar backup de MySQL
# Uso: ./restore.sh backup_file.sql.gz

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup_file.sql.gz>}"
DB_NAME="${DB_NAME:-vetmanager}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -f "$BACKUP_FILE" ]; then
  log "ERROR: File not found: $BACKUP_FILE"
  exit 1
fi

log "WARNING: This will OVERWRITE the database '$DB_NAME' on $DB_HOST"
log "Press Ctrl+C to cancel, or Enter to continue..."
read -r

log "Restoring from $BACKUP_FILE..."
MYSQL_PWD="$DB_PASSWORD" gunzip -c "$BACKUP_FILE" | mysql \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  "$DB_NAME"

log "Restore completed successfully."
