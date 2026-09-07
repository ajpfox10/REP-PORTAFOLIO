#!/bin/bash
# scripts/backup/backup.sh — Backup automatizado de MySQL + Redis
# Cron: 0 2 * * * /app/scripts/backup/backup.sh >> /var/log/vetmanager-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
DB_NAME="${DB_NAME:-vetmanager}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
S3_BUCKET="${S3_BUCKET:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── MySQL backup ───────────────────────────────────────────────────────────────
log "Starting MySQL backup..."
mkdir -p "$BACKUP_DIR/mysql"

DUMP_FILE="$BACKUP_DIR/mysql/${DB_NAME}_${DATE}.sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  "$DB_NAME" | gzip > "$DUMP_FILE"

log "MySQL backup created: $DUMP_FILE ($(du -sh "$DUMP_FILE" | cut -f1))"

# ── Subir a S3 si está configurado ────────────────────────────────────────────
if [ -n "$S3_BUCKET" ]; then
  log "Uploading to S3..."
  aws s3 cp "$DUMP_FILE" "s3://${S3_BUCKET}/mysql/${DB_NAME}_${DATE}.sql.gz" \
    --storage-class STANDARD_IA
  log "Uploaded to s3://${S3_BUCKET}/mysql/"
fi

# ── Limpiar backups viejos ────────────────────────────────────────────────────
log "Cleaning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR/mysql" -name "*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

log "Backup completed successfully."
