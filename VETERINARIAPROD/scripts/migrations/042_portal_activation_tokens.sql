-- Migration 042: one-time activation tokens for owner portal accounts.

CREATE TABLE IF NOT EXISTS portal_activation_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id INT UNSIGNED NULL,
  org_id INT UNSIGNED NOT NULL,
  email VARCHAR(255) NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_portal_activation_token_hash (token_hash),
  KEY idx_portal_activation_client (client_id),
  KEY idx_portal_activation_org_email (org_id, email),
  KEY idx_portal_activation_expires (expires_at)
);
