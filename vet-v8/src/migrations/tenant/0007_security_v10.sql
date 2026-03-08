-- ============================================================
-- Migration 0007 — v10 Security Hardening (Sprint 1-3)
-- ============================================================

-- ── S-03: Login brute-force protection ───────────────────────
-- Persistent fallback when Redis is unavailable.
-- Primary enforcement is Redis-based (loginProtection.ts).
CREATE TABLE IF NOT EXISTS login_attempts (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id        VARCHAR(64)   NOT NULL,
  email_hash       CHAR(64)      NOT NULL  COMMENT 'SHA-256 of tenant_id:email (never store plaintext)',
  attempts         INT           NOT NULL DEFAULT 0,
  last_attempt_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  locked_until     DATETIME      NULL     COMMENT 'NULL = not locked',

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_email (tenant_id, email_hash),
  INDEX idx_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Brute-force login attempt tracking — Redis is primary, this is persistent fallback';

-- ── S-05: Password history ────────────────────────────────────
-- Stores last N bcrypt hashes to prevent password reuse.
CREATE TABLE IF NOT EXISTS password_history (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(36)   NOT NULL,
  tenant_id     VARCHAR(64)   NOT NULL,
  password_hash VARCHAR(255)  NOT NULL  COMMENT 'bcrypt hash — never plain text',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_user_tenant (user_id, tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Last N password hashes per user — used to prevent reuse (passwordPolicy.ts)';

-- ── S-04: Ensure auditoria_log has result column ──────────────
-- Add optional result column (success/failure) for auth events.
ALTER TABLE auditoria_log
  ADD COLUMN IF NOT EXISTS result VARCHAR(16) NULL
    COMMENT 'success | failure — for auth events'
  AFTER action;

-- Add actor_ip as alias index for compliance queries
-- (ip column already exists; this just improves readability of queries)
ALTER TABLE auditoria_log
  ADD INDEX IF NOT EXISTS idx_ip (ip);

-- ── S-10: Record DB SSL enforcement in schema_meta ────────────
-- Informational — no schema change, just migration checkpoint.
-- The actual enforcement is in pools.ts + validateEnv.ts.

-- Mark migration complete
UPDATE schema_meta SET schema_version = 7 WHERE singleton = 1;
