-- ============================================================
-- Migration 0006 — v9 Security Hardening
--   · auth_recovery_codes: code_hash upgraded to 255 chars
--     (was CHAR(64) — SHA-256 hex, now VARCHAR(255) to hold
--      "argon2id$<salt_hex>$<hash_hex>" self-contained format)
--   · auth_recovery_codes: add salt column removed (now embedded in hash)
--   · auth_recovery_codes: add created_ip for audit trail
--   · users: internalApiToken support (no schema change needed, config only)
-- ============================================================

-- Expand code_hash to hold the new "argon2id$<salt>$<hash>" format
ALTER TABLE auth_recovery_codes
  MODIFY COLUMN code_hash VARCHAR(255) NOT NULL
    COMMENT 'argon2id$<salt_hex>$<hash_hex> — v9 format. Old SHA-256 entries invalid after migration.';

-- Audit: track IP at code creation for fraud detection
ALTER TABLE auth_recovery_codes
  ADD COLUMN IF NOT EXISTS created_ip VARCHAR(45) NULL
    COMMENT 'IPv4/IPv6 of the request that generated this code';

-- Invalidate all old SHA-256 hashed codes (they are 64-char hex, no $ separator)
-- After this migration, users with old codes must regenerate them.
-- The application will detect the format mismatch in verifyRecoveryCode() and return false.
-- No DELETE needed — old-format codes simply won't verify, forcing re-enrollment.

UPDATE auth_recovery_codes
  SET used = 1,
      used_at = NOW()
  WHERE used = 0
    AND code_hash NOT LIKE 'argon2id$%';
