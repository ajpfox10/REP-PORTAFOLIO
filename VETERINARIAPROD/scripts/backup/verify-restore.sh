#!/bin/bash
# Verifica restore básico sobre una base ya restaurada

set -euo pipefail

DB_NAME="${DB_NAME:-vetmanager}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

run_sql() {
  MYSQL_PWD="$DB_PASSWORD" mysql -N -B -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -e "$1"
}

log "Checking core tables..."
run_sql "SELECT COUNT(*) FROM users;"
run_sql "SELECT COUNT(*) FROM patients;"
run_sql "SELECT COUNT(*) FROM medical_records;"
run_sql "SELECT COUNT(*) FROM invoices;"

log "Checking migration history..."
run_sql "SELECT COUNT(*) FROM migration_history;"

log "Restore verification completed."
