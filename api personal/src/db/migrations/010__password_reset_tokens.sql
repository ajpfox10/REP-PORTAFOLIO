-- Migration: 010__password_reset_tokens.sql
-- Description: Add password reset tokens table for password recovery flow

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  INDEX idx_usuario_id (usuario_id),
  INDEX idx_expires_at (expires_at),
  CONSTRAINT fk_password_reset_tokens_usuario 
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add index for efficient cleanup of expired tokens
CREATE INDEX idx_cleanup ON password_reset_tokens(expires_at, used_at);
