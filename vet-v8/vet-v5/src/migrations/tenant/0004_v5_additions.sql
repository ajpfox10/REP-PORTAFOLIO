-- ============================================================
-- Migration 0004 — v5 additions
--   · password_hash en propietarios (portal login)
--   · Soft-delete en consultas, vacunas, desparasitaciones
--   · indices extra para scheduler queries
--   · tabla portal_tokens para invite links
-- ============================================================

-- Agregar password_hash a propietarios para portal login
ALTER TABLE propietarios
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL
    COMMENT 'Bcrypt hash para acceso al portal de propietarios'
  AFTER email;

-- Soft delete en consultas (nunca eliminar datos clínicos)
ALTER TABLE consultas
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER updated_at;

-- Soft delete en vacunas
ALTER TABLE vacunas
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER notas;

-- Soft delete en desparasitaciones
ALTER TABLE desparasitaciones
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER proxima_dosis;

-- Índice para queries del scheduler (turnos con recordatorio pendiente)
CREATE INDEX IF NOT EXISTS idx_turnos_recordatorio
  ON turnos (tenant_id, recordatorio_env, fecha_hora, estado);

-- Índice para queries del scheduler (vacunas próximas)
CREATE INDEX IF NOT EXISTS idx_vacunas_proxima_recordatorio
  ON vacunas (tenant_id, proxima_dosis, recordatorio_env);

-- Portal invite tokens (para que la clínica invite propietarios)
CREATE TABLE IF NOT EXISTS portal_invite_tokens (
  id          VARCHAR(64)   NOT NULL,
  tenant_id   VARCHAR(64)   NOT NULL,
  email       VARCHAR(255)  NOT NULL,
  expires_at  DATETIME      NOT NULL,
  used        TINYINT(1)    NOT NULL DEFAULT 0,
  created_by  VARCHAR(64)   NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_tenant_email (tenant_id, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabla para webhooks salientes (enterprise)
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          VARCHAR(64)   NOT NULL,
  tenant_id   VARCHAR(64)   NOT NULL,
  url         VARCHAR(512)  NOT NULL,
  secret_hash VARCHAR(255)  NOT NULL COMMENT 'HMAC-SHA256 signing secret (hashed)',
  events_json JSON          NOT NULL COMMENT 'Array of event types to receive',
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Log de intentos de entrega de webhooks
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            VARCHAR(64)   NOT NULL,
  tenant_id     VARCHAR(64)   NOT NULL,
  endpoint_id   VARCHAR(64)   NOT NULL,
  event_type    VARCHAR(64)   NOT NULL,
  payload_json  JSON          NOT NULL,
  status_code   INT           NULL,
  response_body TEXT          NULL,
  attempt       INT           NOT NULL DEFAULT 1,
  delivered_at  DATETIME      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_endpoint (endpoint_id),
  INDEX idx_tenant_event (tenant_id, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
