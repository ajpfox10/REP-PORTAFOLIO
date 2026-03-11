-- scanner_saas v3 schema
-- Compatible con MySQL 8.0+
-- Integración con api_personal via personal_dni / personal_ref

SET foreign_key_checks = 0;

-- ── Migrations tracker ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Tenants ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(200) NOT NULL,
  plan       ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free',
  api_key    VARCHAR(255) NOT NULL UNIQUE,          -- para que el personal-api autentique
  is_active  TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id     BIGINT NOT NULL,
  email         VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator',
  token_version INT NOT NULL DEFAULT 0,
  is_active     TINYINT NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  INDEX ix_users_tenant (tenant_id)
);

-- ── Devices ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id    BIGINT NOT NULL,
  name         VARCHAR(200) NOT NULL,
  driver       ENUM('wia','twain','virtual') NOT NULL DEFAULT 'wia',
  device_key   VARCHAR(200) NOT NULL,              -- secret compartido con el agent
  is_active    TINYINT NOT NULL DEFAULT 1,
  hostname     VARCHAR(200) NULL,                  -- hostname del agente conectado
  agent_version VARCHAR(50) NULL,
  last_seen_at TIMESTAMP NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_devices_tenant (tenant_id)
);

-- ── Scan profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_profiles (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id             BIGINT NOT NULL,
  name                  VARCHAR(200) NOT NULL,
  dpi                   INT NOT NULL DEFAULT 300,
  color                 TINYINT NOT NULL DEFAULT 1,
  auto_rotate           TINYINT NOT NULL DEFAULT 1,
  blank_page_detection  TINYINT NOT NULL DEFAULT 1,
  compression           ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  output_format         ENUM('pdf','pdf_a','tiff') NOT NULL DEFAULT 'pdf',
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_profiles_tenant (tenant_id)
);

-- ── Scan jobs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_jobs (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id      BIGINT NOT NULL,
  device_id      BIGINT NOT NULL,
  profile_id     BIGINT NULL,
  priority       TINYINT NOT NULL DEFAULT 0,
  status         ENUM('queued','in_progress','completed','failed','canceled') NOT NULL DEFAULT 'queued',
  page_count     INT NULL,
  error_message  TEXT NULL,
  -- Integration con api_personal
  personal_dni   BIGINT NULL,                      -- DNI del agente escaneado
  personal_ref   VARCHAR(200) NULL,                -- referencia libre (ej: "pedido:123")
  -- nonce para que el agent autentique el upload
  upload_nonce   VARCHAR(128) NULL,
  started_at     TIMESTAMP NULL,
  completed_at   TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_jobs_tenant (tenant_id),
  INDEX ix_jobs_status (tenant_id, status),
  INDEX ix_jobs_device (tenant_id, device_id),
  INDEX ix_jobs_dni (tenant_id, personal_dni)
);

-- ── Documents ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id      BIGINT NOT NULL,
  scan_job_id    BIGINT NOT NULL,
  title          VARCHAR(255) NULL,
  storage_key    VARCHAR(500) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  page_count     INT NULL,
  file_size_bytes BIGINT NULL,
  doc_class      VARCHAR(50) NOT NULL DEFAULT 'unknown',
  extracted_json JSON NULL,
  ocr_text       LONGTEXT NULL,
  search_text    LONGTEXT NULL,
  -- virus scan
  av_scanned     TINYINT NOT NULL DEFAULT 0,
  av_clean       TINYINT NOT NULL DEFAULT 1,
  av_result      VARCHAR(200) NULL,
  -- integration
  personal_dni   BIGINT NULL,
  personal_ref   VARCHAR(200) NULL,
  -- soft delete
  deleted_at     TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_docs_tenant (tenant_id),
  INDEX ix_docs_job (tenant_id, scan_job_id),
  INDEX ix_docs_dni (tenant_id, personal_dni),
  INDEX ix_docs_class (tenant_id, doc_class),
  FULLTEXT KEY ft_docs_search (search_text)
);

-- ── Document pages (para QR separation y visualización por página) ─────────────
CREATE TABLE IF NOT EXISTS document_pages (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id    BIGINT NOT NULL,
  document_id  BIGINT NOT NULL,
  page_number  INT NOT NULL,
  storage_key  VARCHAR(500) NOT NULL,             -- imagen de la página
  ocr_text     LONGTEXT NULL,
  qr_payload   VARCHAR(500) NULL,                 -- QR detectado en la página
  is_blank     TINYINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_pages_doc (tenant_id, document_id),
  INDEX ix_pages_qr (tenant_id, qr_payload(50))
);

-- ── Webhooks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id                   BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id            BIGINT NOT NULL,
  url                  VARCHAR(500) NOT NULL,
  events_json          JSON NOT NULL,
  secret               VARCHAR(200) NOT NULL,
  is_active            TINYINT NOT NULL DEFAULT 1,
  last_delivery_at     TIMESTAMP NULL,
  last_delivery_status INT NULL,
  fail_count           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_webhooks_tenant (tenant_id)
);

-- ── Webhook delivery log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  webhook_id  BIGINT NOT NULL,
  tenant_id   BIGINT NOT NULL,
  event       VARCHAR(100) NOT NULL,
  payload_json JSON NOT NULL,
  status_code INT NULL,
  success     TINYINT NOT NULL DEFAULT 0,
  error_msg   TEXT NULL,
  duration_ms INT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_deliveries_webhook (webhook_id),
  INDEX ix_deliveries_tenant (tenant_id)
);

-- ── API logs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_logs (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id    BIGINT NULL,
  level        VARCHAR(20) NOT NULL,
  message      TEXT NOT NULL,
  context_json JSON NULL,
  request_id   VARCHAR(64) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_logs_tenant (tenant_id),
  INDEX ix_logs_level (level),
  INDEX ix_logs_ts (created_at)
);

-- ── Personal API integration config (por tenant) ──────────────────────────────
CREATE TABLE IF NOT EXISTS personal_integration (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id  BIGINT NOT NULL UNIQUE,
  base_url   VARCHAR(500) NOT NULL,
  api_key    VARCHAR(255) NOT NULL,
  is_enabled TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP
);

SET foreign_key_checks = 1;

-- ── Device capabilities (reportadas por el agent en heartbeat) ────────────────
CREATE TABLE IF NOT EXISTS device_capabilities (
  device_id         BIGINT PRIMARY KEY,
  capabilities_json JSON NOT NULL,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_caps_device (device_id)
);
