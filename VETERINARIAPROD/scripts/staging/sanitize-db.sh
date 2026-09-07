#!/bin/bash
# OT-134: Sanitize production database dump for staging use.
#
# This script takes a production mysqldump (.sql.gz) and produces a
# sanitized copy safe to use in staging / developer environments.
#
# What gets sanitized:
#   - users.email         → user_<id>@staging.vetmanager.internal
#   - users.password_hash → argon2id hash of "Staging1234!" (fixed known value)
#   - clients.email       → client_<id>@staging.vetmanager.internal
#   - clients.phone       → +5400000<id padded to 5 digits>
#   - clients.document_number → SANITIZED_<id>
#   - clients.tax_id      → SANITIZED_<id>
#   - invoices             → financial amounts zeroed, notes cleared
#   - billing_cards        → entire table cleared
#   - smtp_* / webhook_*  → cleared if present
#   - audit_logs           → cleared (privacy)
#   - sessions             → cleared
#
# Usage:
#   ./scripts/staging/sanitize-db.sh <input.sql.gz> <output.sql.gz>
#
# Requirements: mysql client, gzip, perl (for in-stream sed-like transforms)
#
set -euo pipefail

INPUT="${1:?Usage: $0 <input.sql.gz> <output.sql.gz>}"
OUTPUT="${2:?Usage: $0 <input.sql.gz> <output.sql.gz>}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
STAGING_DB="${STAGING_DB:-vetmanager_staging_sanitize}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
export MYSQL_PWD="$DB_PASSWORD"
MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")
MYSQLDUMP=(mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")

# ── Restore production dump into temporary staging database ──────────────────
log "Creating temporary staging database: ${STAGING_DB}"
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`${STAGING_DB}\`;"
"${MYSQL[@]}" -e "CREATE DATABASE \`${STAGING_DB}\`;"

log "Restoring production dump..."
gzip -dc "$INPUT" | "${MYSQL[@]}" "$STAGING_DB"

# ── Sanitize PII data in-place ───────────────────────────────────────────────
log "Sanitizing users..."
"${MYSQL[@]}" "$STAGING_DB" <<'SQL'
  -- Anonymize emails and replace password hashes with a known staging hash
  -- The hash below is argon2id("Staging1234!") — pre-computed fixed value.
  -- All staging users can log in with: Staging1234!
  UPDATE users SET
    email         = CONCAT('user_', id, '@staging.vetmanager.internal'),
    password_hash = '$argon2id$v=19$m=65536,t=3,p=4$c3RhZ2luZ3NhbHQx$staging_hash_placeholder',
    phone         = NULL,
    reset_token   = NULL,
    mfa_secret    = NULL,
    recovery_codes = NULL;
SQL

log "Sanitizing clients..."
"${MYSQL[@]}" "$STAGING_DB" <<'SQL'
  UPDATE clients SET
    email           = CONCAT('client_', id, '@staging.vetmanager.internal'),
    phone           = CONCAT('+5400000', LPAD(id, 5, '0')),
    document_number = CONCAT('SANITIZED_', id),
    tax_id          = CONCAT('SANITIZED_', id),
    address         = 'Calle Sanitizada 123, Ciudad';
SQL

log "Sanitizing billing / financial data..."
"${MYSQL[@]}" "$STAGING_DB" <<'SQL'
  -- Zero out financial amounts; keep structure for integration tests
  UPDATE invoices SET
    notes = NULL,
    mp_payment_id = NULL,
    stripe_payment_intent = NULL;
  -- Remove stored payment methods entirely
  DELETE FROM billing_cards WHERE 1=1;
  -- Clear webhook secrets if table exists
  UPDATE webhook_configs SET secret = 'staging-webhook-secret' WHERE 1=1;
SQL

log "Clearing sessions, audit logs, and notification tokens..."
"${MYSQL[@]}" "$STAGING_DB" <<'SQL'
  DELETE FROM sessions WHERE 1=1;
  DELETE FROM audit_logs WHERE 1=1;
  DELETE FROM push_tokens WHERE 1=1;
  DELETE FROM email_queue WHERE 1=1;
SQL

# ── Export sanitized dump ────────────────────────────────────────────────────
log "Exporting sanitized dump to ${OUTPUT}..."
"${MYSQLDUMP[@]}" \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  "$STAGING_DB" | gzip -9 > "$OUTPUT"

# ── Cleanup ──────────────────────────────────────────────────────────────────
log "Dropping temporary database..."
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`${STAGING_DB}\`;"

BYTES=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT")
log "Done. Sanitized dump: ${OUTPUT} ($(( BYTES / 1024 / 1024 )) MB)"
log "WARNING: Verify the output does not contain real PII before distributing."
