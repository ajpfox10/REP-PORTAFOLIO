#!/bin/bash
# scripts/backup/backup.sh

set -euo pipefail

# Configuración
BACKUP_DIR="${1:-/backups/personalv5}"
DB_HOST="${2:-localhost}"
DB_PORT="${3:-3306}"
DB_NAME="${4:-personalv5}"
DB_USER="${5:-root}"
DB_PASSWORD="${6:-}"
DOCS_DIR="${7:-/mnt/g/RESOLUCIONES\ Y\ VARIOS}"
RETENTION_DAYS="${8:-30}"
COMPRESS="${9:-true}"
NOTIFY_EMAIL="${10:-}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE_STAMP=$(date +%Y%m%d)

# Directorios
DB_BACKUP_DIR="$BACKUP_DIR/db"
DOCS_BACKUP_DIR="$BACKUP_DIR/docs"
LOGS_DIR="$BACKUP_DIR/logs"

mkdir -p "$DB_BACKUP_DIR" "$DOCS_BACKUP_DIR" "$LOGS_DIR"

LOG_FILE="$LOGS_DIR/backup_$DATE_STAMP.log"
ERROR_LOG="$LOGS_DIR/backup_error_$DATE_STAMP.log"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() {
    echo -e "${CYAN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$ERROR_LOG" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✅ $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ $1${NC}" | tee -a "$LOG_FILE"
}

send_notification() {
    local subject="$1"
    local body="$2"
    if [[ -n "$NOTIFY_EMAIL" ]]; then
        echo "$body" | mail -s "$subject" "$NOTIFY_EMAIL" 2>/dev/null || warn "Fallo envío de email"
    fi
}

log "========================================="
log "Iniciando backup - $TIMESTAMP"
log "========================================="

SUCCESS=true
ERRORS=()

# 1. BACKUP BASE DE DATOS
log "1. Backupeando base de datos: $DB_NAME"
DB_BACKUP_FILE="$DB_BACKUP_DIR/db_$TIMESTAMP.sql"

MYSQLDUMP_CMD="mysqldump -h $DB_HOST -P $DB_PORT -u $DB_USER --single-transaction --routines --triggers --events $DB_NAME"

if [[ -n "$DB_PASSWORD" ]]; then
    MYSQLDUMP_CMD="$MYSQLDUMP_CMD -p'$DB_PASSWORD'"
fi

if [[ "$COMPRESS" == "true" ]]; then
    DB_COMPRESSED_FILE="$DB_BACKUP_DIR/db_$TIMESTAMP.sql.gz"
    log "Generando backup comprimido (gzip)..."
    eval "$MYSQLDUMP_CMD" | gzip -9 > "$DB_COMPRESSED_FILE"
    
    if [[ $? -eq 0 && -f "$DB_COMPRESSED_FILE" ]]; then
        SIZE=$(du -h "$DB_COMPRESSED_FILE" | cut -f1)
        success "Backup DB comprimido: $DB_COMPRESSED_FILE ($SIZE)"
    else
        SUCCESS=false
        ERRORS+=("DB compressed backup failed")
        error "❌ Error backup DB comprimido"
    fi
else
    eval "$MYSQLDUMP_CMD" > "$DB_BACKUP_FILE"
    if [[ $? -eq 0 && -f "$DB_BACKUP_FILE" ]]; then
        SIZE=$(du -h "$DB_BACKUP_FILE" | cut -f1)
        success "Backup DB: $DB_BACKUP_FILE ($SIZE)"
    else
        SUCCESS=false
        ERRORS+=("DB backup failed")
        error "❌ Error backup DB"
    fi
fi

# 2. BACKUP DOCUMENTOS
log "2. Backupeando documentos: $DOCS_DIR"

if [[ -d "$DOCS_DIR" ]]; then
    DOCS_BACKUP_FILE="$DOCS_BACKUP_DIR/docs_$TIMESTAMP.tar.gz"
    log "Comprimiendo documentos..."
    
    tar -czf "$DOCS_BACKUP_FILE" -C "$(dirname "$DOCS_DIR")" "$(basename "$DOCS_DIR")" 2>/dev/null
    
    if [[ $? -eq 0 && -f "$DOCS_BACKUP_FILE" ]]; then
        SIZE=$(du -h "$DOCS_BACKUP_FILE" | cut -f1)
        success "Backup documentos: $DOCS_BACKUP_FILE ($SIZE)"
    else
        SUCCESS=false
        ERRORS+=("Docs backup failed")
        error "❌ Error backup documentos"
    fi
else
    warn "⚠️ Directorio de documentos no encontrado: $DOCS_DIR"
fi

# 3. LIMPIEZA BACKUPS VIEJOS
log "3. Limpiando backups con más de $RETENTION_DAYS días"

find "$DB_BACKUP_DIR" -name "db_*.sql*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null
DELETED_DB=$?
find "$DOCS_BACKUP_DIR" -name "docs_*.tar.gz" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null
DELETED_DOCS=$?

if [[ $DELETED_DB -eq 0 && $DELETED_DOCS -eq 0 ]]; then
    success "Limpieza completada"
fi

# 4. RESUMEN
log "========================================="
if [[ "$SUCCESS" == true ]]; then
    success "🎉 BACKUP COMPLETADO EXITOSAMENTE"
    log "📁 DB: $DB_BACKUP_DIR"
    log "📁 Docs: $DOCS_BACKUP_DIR"
    log "📁 Logs: $LOGS_DIR"
    
    if [[ -n "$NOTIFY_EMAIL" ]]; then
        send_notification "✅ Backup exitoso - $DB_NAME" \
            "Fecha: $TIMESTAMP\nDB: $DB_NAME\nEstado: EXITOSO\nRetención: $RETENTION_DAYS días"
    fi
else
    log "❌ BACKUP COMPLETADO CON ERRORES"
    for err in "${ERRORS[@]}"; do
        log "   - $err"
    done
    
    if [[ -n "$NOTIFY_EMAIL" ]]; then
        send_notification "❌ Backup fallido - $DB_NAME" \
            "Fecha: $TIMESTAMP\nDB: $DB_NAME\nEstado: FALLIDO\nErrores:\n$(printf '%s\n' "${ERRORS[@]}")"
    fi
fi

log "========================================="

if [[ "$SUCCESS" == true ]]; then
    exit 0
else
    exit 1
fi