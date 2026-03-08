-- ============================================================================
-- VETERINARIA SAAS PLATFORM — MASTER DATABASE
-- Versión: 3.0.0  |  Motor: MySQL 8.4 InnoDB  |  Charset: utf8mb4
--
-- Este script crea la base "veterinaria_master" que actúa como registry
-- de tenants, configuración global, billing y feature flags.
--
-- Ejecutar como: mysql -u root -p < master.sql
-- ============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;

CREATE DATABASE IF NOT EXISTS veterinaria_master
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE veterinaria_master;

-- ────────────────────────────────────────────────────────────────────────────
-- TENANTS — Registro global de clínicas
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id       VARCHAR(64)   NOT NULL,
  subdomain       VARCHAR(128)  NOT NULL,
  db_name         VARCHAR(128)  NOT NULL,
  status          ENUM('active','disabled','suspended','trial') NOT NULL DEFAULT 'trial',
  plan            ENUM('basic','pro','enterprise','custom') NOT NULL DEFAULT 'basic',
  region          VARCHAR(16)   NOT NULL DEFAULT 'AR',
  default_locale  VARCHAR(8)    NOT NULL DEFAULT 'es',
  trial_ends_at   DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (tenant_id),
  UNIQUE KEY uq_subdomain (subdomain),
  UNIQUE KEY uq_db_name (db_name),
  INDEX idx_status (status),
  INDEX idx_plan (plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Central tenant registry — one row per vetenary clinic';


-- ────────────────────────────────────────────────────────────────────────────
-- TENANT PLUGINS — Marketplace de plugins habilitados por tenant
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_plugins (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id   VARCHAR(64)   NOT NULL,
  plugin_key  VARCHAR(128)  NOT NULL,
  enabled     TINYINT(1)    NOT NULL DEFAULT 1,
  config_json JSON          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_plugin (tenant_id, plugin_key),
  INDEX idx_tenant (tenant_id),
  CONSTRAINT fk_tp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- TENANT FEATURES — Feature flags por tenant (granularidad fina)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_features (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id   VARCHAR(64)   NOT NULL,
  feature_key VARCHAR(128)  NOT NULL,
  enabled     TINYINT(1)    NOT NULL DEFAULT 1,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_feature (tenant_id, feature_key),
  INDEX idx_tenant (tenant_id),
  CONSTRAINT fk_tf_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- TENANT PLAN OVERRIDES — Límites custom por tenant (enterprise deals)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_plan_overrides (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  overrides_json  JSON          NOT NULL COMMENT 'Partial PlanLimits override, e.g. {"max_users": 500}',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(64)   NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant (tenant_id),
  CONSTRAINT fk_tpo_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- TENANT DATA KEYS — KMS envelope encryption: encrypted DEKs por tenant
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_data_keys (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id         VARCHAR(64)   NOT NULL,
  key_version       INT           NOT NULL DEFAULT 1,
  encrypted_dek_b64 TEXT          NOT NULL COMMENT 'Base64 of KMS-encrypted AES-256 data key',
  kms_key_id        VARCHAR(256)  NULL     COMMENT 'AWS KMS CMK ARN used to wrap this DEK',
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_version (tenant_id, key_version),
  INDEX idx_tenant (tenant_id),
  CONSTRAINT fk_tdk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encrypted Data Encryption Keys for field-level encryption';


-- ────────────────────────────────────────────────────────────────────────────
-- BILLING — Suscripciones Stripe
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                    BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id             VARCHAR(64)   NOT NULL,
  stripe_subscription_id VARCHAR(128) NOT NULL,
  stripe_customer_id    VARCHAR(128)  NOT NULL,
  status                VARCHAR(32)   NOT NULL DEFAULT 'active',
  plan                  VARCHAR(32)   NOT NULL,
  current_period_start  DATETIME      NULL,
  current_period_end    DATETIME      NULL,
  cancel_at             DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_stripe_sub (stripe_subscription_id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  CONSTRAINT fk_bs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook event deduplication (idempotency)
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  stripe_event_id VARCHAR(128)  NOT NULL,
  event_type      VARCHAR(128)  NOT NULL,
  processed_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (stripe_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Idempotency store for Stripe webhook events';


-- ────────────────────────────────────────────────────────────────────────────
-- ADMIN AUDIT — Acciones del panel interno (provisioning, impersonación, etc.)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  ts          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor       VARCHAR(128)  NOT NULL COMMENT 'Support user or system',
  action      VARCHAR(64)   NOT NULL,
  tenant_id   VARCHAR(64)   NULL,
  resource    VARCHAR(128)  NULL,
  resource_id VARCHAR(128)  NULL,
  ip          VARCHAR(64)   NULL,
  details_json JSON         NULL,

  PRIMARY KEY (id),
  INDEX idx_ts (ts),
  INDEX idx_actor (actor),
  INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET foreign_key_checks = 1;
