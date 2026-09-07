#!/bin/bash
set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup_file.sql.gz>}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-vetmanager_restore_drill}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")
export MYSQL_PWD="$DB_PASSWORD"

log "Dropping previous drill database if exists..."
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`${RESTORE_DB_NAME}\`;"

log "Creating drill database..."
"${MYSQL[@]}" -e "CREATE DATABASE \`${RESTORE_DB_NAME}\`;"

log "Restoring backup into ${RESTORE_DB_NAME}..."
gzip -dc "$BACKUP_FILE" | "${MYSQL[@]}" "$RESTORE_DB_NAME"

log "Running restore verification..."
DB_NAME="$RESTORE_DB_NAME" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" ./scripts/backup/verify-restore.sh

log "Restore drill completed successfully."
