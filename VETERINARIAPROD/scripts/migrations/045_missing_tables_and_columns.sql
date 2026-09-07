-- ============================================================
-- Migration 045: tablas y columnas faltantes detectadas en
-- auditoría de sincronización código↔BD (2026-05-26)
-- ============================================================

-- 1. event_outbox (migration 040 nunca se ejecutó vía runner)
CREATE TABLE IF NOT EXISTS event_outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  topic         VARCHAR(160) NOT NULL,
  payload_json  JSON NOT NULL,
  meta_json     JSON NULL,
  status        ENUM('pending','processing','published','failed') NOT NULL DEFAULT 'pending',
  stream_id     VARCHAR(80) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts  INT UNSIGNED NOT NULL DEFAULT 10,
  next_attempt_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  published_at  DATETIME NULL,
  last_error    VARCHAR(512) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_outbox_status_next (status, next_attempt_at),
  KEY idx_event_outbox_topic_created (topic, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. GDPR: gdpr_consents
CREATE TABLE IF NOT EXISTS gdpr_consents (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id      INT UNSIGNED NOT NULL,
  org_id         INT UNSIGNED NOT NULL,
  consent_type   ENUM('marketing','analytics','third_party','data_processing','communications') NOT NULL,
  granted        TINYINT(1) NOT NULL DEFAULT 0,
  granted_at     DATETIME NULL,
  withdrawn_at   DATETIME NULL,
  ip_address     VARCHAR(45) NULL,
  user_agent     VARCHAR(500) NULL,
  notes          TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gdpr_consents_client_type (client_id, consent_type),
  KEY idx_gdpr_consents_org (org_id),
  CONSTRAINT fk_gdpr_consents_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. GDPR: gdpr_data_requests
CREATE TABLE IF NOT EXISTS gdpr_data_requests (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id       INT UNSIGNED NOT NULL,
  org_id          INT UNSIGNED NOT NULL,
  branch_id       INT UNSIGNED NOT NULL,
  request_type    ENUM('access','deletion','rectification','portability','restriction','objection') NOT NULL,
  status          ENUM('pending','in_progress','completed','rejected','cancelled') NOT NULL DEFAULT 'pending',
  notes           TEXT NULL,
  response_notes  TEXT NULL,
  requested_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date        DATETIME NULL,
  completed_at    DATETIME NULL,
  completed_by    INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gdpr_requests_client (client_id),
  KEY idx_gdpr_requests_org_status (org_id, status),
  CONSTRAINT fk_gdpr_requests_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. GDPR: gdpr_audit_trail
CREATE TABLE IF NOT EXISTS gdpr_audit_trail (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id      INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NULL,
  action      VARCHAR(100) NOT NULL,
  performed_by INT UNSIGNED NULL,
  detail_json JSON NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gdpr_audit_org (org_id),
  KEY idx_gdpr_audit_client (client_id),
  KEY idx_gdpr_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. data_breaches
CREATE TABLE IF NOT EXISTS data_breaches (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id           INT UNSIGNED NOT NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  severity         ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status           ENUM('detected','investigating','contained','resolved','notified') NOT NULL DEFAULT 'detected',
  detected_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contained_at     DATETIME NULL,
  resolved_at      DATETIME NULL,
  affected_records INT UNSIGNED NOT NULL DEFAULT 0,
  data_types       JSON NULL,
  notified_at      DATETIME NULL,
  notified_by      INT UNSIGNED NULL,
  response_notes   TEXT NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_data_breaches_org (org_id),
  KEY idx_data_breaches_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. google_calendar_tokens
CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  org_id        INT UNSIGNED NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NULL,
  token_type    VARCHAR(40) NOT NULL DEFAULT 'Bearer',
  scope         TEXT NULL,
  expires_at    DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gcal_tokens_user (user_id),
  KEY idx_gcal_tokens_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. permission_change_audit
CREATE TABLE IF NOT EXISTS permission_change_audit (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id        INT UNSIGNED NOT NULL,
  actor_id      INT UNSIGNED NOT NULL,
  target_user_id INT UNSIGNED NULL,
  target_role_id INT UNSIGNED NULL,
  change_type   ENUM('role_assigned','role_revoked','permission_granted','permission_revoked','feature_flag_changed','user_created','user_deactivated','user_reactivated') NOT NULL,
  detail_json   JSON NULL,
  ip_address    VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pca_org (org_id),
  KEY idx_pca_actor (actor_id),
  KEY idx_pca_target_user (target_user_id),
  KEY idx_pca_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. portal_fcm_tokens (FCM tokens de clientes del portal — separado de staff)
CREATE TABLE IF NOT EXISTS portal_fcm_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id    INT UNSIGNED NOT NULL,
  org_id       INT UNSIGNED NOT NULL,
  token        VARCHAR(512) NOT NULL,
  platform     ENUM('web','android','ios') NOT NULL DEFAULT 'web',
  device_name  VARCHAR(120) NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  last_used_at DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_fcm_token (token),
  KEY idx_portal_fcm_client (client_id),
  KEY idx_portal_fcm_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- COLUMNAS FALTANTES EN TABLAS EXISTENTES
-- ============================================================

-- 9. tenants: columnas Stripe
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id      VARCHAR(64)  NULL AFTER status,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  VARCHAR(64)  NULL AFTER stripe_customer_id,
  ADD COLUMN IF NOT EXISTS stripe_price_id         VARCHAR(64)  NULL AFTER stripe_subscription_id,
  ADD COLUMN IF NOT EXISTS billing_email           VARCHAR(255) NULL AFTER stripe_price_id,
  ADD COLUMN IF NOT EXISTS next_billing_date       DATE         NULL AFTER billing_email;

-- 10. clients: is_anonymized (flag rápido para queries de anonimización)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_anonymized  TINYINT(1) NOT NULL DEFAULT 0 AFTER anonymized_at,
  ADD COLUMN IF NOT EXISTS birthdate      DATE       NULL AFTER postal_code;

-- Sincronizar is_anonymized desde anonymized_at existente
UPDATE clients SET is_anonymized = 1 WHERE anonymized_at IS NOT NULL AND is_anonymized = 0;

-- 11. webrtc_waiting_room: decided_by (quién tomó la decisión)
ALTER TABLE webrtc_waiting_room
  ADD COLUMN IF NOT EXISTS decided_by INT UNSIGNED NULL AFTER acted_at;

-- 12. patient_owners: updated_at
ALTER TABLE patient_owners
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- ============================================================
-- ÍNDICES FALTANTES en columnas de tenant (performance crítica)
-- ============================================================
ALTER TABLE appointments       ADD INDEX IF NOT EXISTS idx_appointments_client_id (client_id);
ALTER TABLE clients            ADD INDEX IF NOT EXISTS idx_clients_organization_id (organization_id);
ALTER TABLE audit_logs         ADD INDEX IF NOT EXISTS idx_audit_logs_branch_id (branch_id);
ALTER TABLE login_history      ADD INDEX IF NOT EXISTS idx_login_history_org_id (organization_id);
ALTER TABLE login_history      ADD INDEX IF NOT EXISTS idx_login_history_client_id (client_id);
ALTER TABLE report_runs        ADD INDEX IF NOT EXISTS idx_report_runs_org_id (org_id);
ALTER TABLE report_runs        ADD INDEX IF NOT EXISTS idx_report_runs_branch_id (branch_id);
ALTER TABLE user_fcm_tokens    ADD INDEX IF NOT EXISTS idx_user_fcm_tokens_org_id (org_id);
ALTER TABLE user_sessions      ADD INDEX IF NOT EXISTS idx_user_sessions_org_id (organization_id);
ALTER TABLE users              ADD INDEX IF NOT EXISTS idx_users_branch_id (branch_id);
ALTER TABLE reminders          ADD INDEX IF NOT EXISTS idx_reminders_client_id (client_id);
ALTER TABLE patient_transfers  ADD INDEX IF NOT EXISTS idx_patient_transfers_client_id (client_id);
ALTER TABLE mail_document_inbox ADD INDEX IF NOT EXISTS idx_mail_inbox_branch_id (branch_id);
ALTER TABLE appointment_types  ADD INDEX IF NOT EXISTS idx_appt_types_org_id (organization_id);
ALTER TABLE lab_tests          ADD INDEX IF NOT EXISTS idx_lab_tests_org_id (organization_id);
ALTER TABLE surgery_types      ADD INDEX IF NOT EXISTS idx_surgery_types_org_id (organization_id);
