-- Migration: 011__two_factor_auth.sql
-- Description: Add 2FA support with two_factor_codes table and usuario flag

-- Add two_factor_enabled column to usuarios table
ALTER TABLE usuarios 
ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER active;

-- Create two_factor_codes table
CREATE TABLE IF NOT EXISTS two_factor_codes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL DEFAULT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_usuario_id (usuario_id),
  INDEX idx_code_hash (code_hash),
  INDEX idx_expires_at (expires_at),
  INDEX idx_cleanup (expires_at, verified_at),
  CONSTRAINT fk_two_factor_codes_usuario 
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
