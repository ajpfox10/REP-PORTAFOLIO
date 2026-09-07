-- Migration 043: isolate owner portal password resets from internal user resets.

CREATE TABLE IF NOT EXISTS portal_password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id INT UNSIGNED NOT NULL,
  org_id INT UNSIGNED NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_portal_password_reset_token_hash (token_hash),
  UNIQUE KEY uq_portal_password_reset_client (client_id),
  KEY idx_portal_password_reset_org_client (org_id, client_id),
  KEY idx_portal_password_reset_expires (expires_at)
);
