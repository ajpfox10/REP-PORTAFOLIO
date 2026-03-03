-- Migration: 000__fix_schema_for_production.sql
-- Description: Fix schema to match production and add missing features
-- Run this FIRST before any other migrations

-- ============================================================
-- 1. Fix `roles` table - add missing timestamps
-- ============================================================
ALTER TABLE `roles` 
ADD COLUMN `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP AFTER `descripcion`,
ADD COLUMN `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

-- ============================================================
-- 2. Fix `usuarios` table - add missing columns
-- ============================================================

-- Rename password to password_hash
ALTER TABLE `usuarios` 
CHANGE COLUMN `password` `password_hash` VARCHAR(255) NOT NULL;

-- Add active column (map from estado)
ALTER TABLE `usuarios` 
ADD COLUMN `active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `estado`;

-- Update active based on estado
UPDATE `usuarios` SET `active` = 1 WHERE `estado` = 'activo';
UPDATE `usuarios` SET `active` = 0 WHERE `estado` = 'inactivo';

-- Add role_id (will be nullable first, then we'll set defaults)
ALTER TABLE `usuarios` 
ADD COLUMN `rol_id` INT NULL AFTER `nombre`,
ADD INDEX `idx_usuarios_rol_id` (`rol_id`),
ADD CONSTRAINT `fk_usuarios_rol` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL;

-- Rename timestamps to match convention
ALTER TABLE `usuarios`
CHANGE COLUMN `creado_en` `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
CHANGE COLUMN `actualizado_en` `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add two_factor_enabled column for 2FA support
ALTER TABLE `usuarios` 
ADD COLUMN `two_factor_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `active`;

-- ============================================================
-- 3. Create password_reset_tokens table
-- ============================================================
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_token_hash` (`token_hash`),
  INDEX `idx_usuario_id` (`usuario_id`),
  INDEX `idx_expires_at` (`expires_at`),
  INDEX `idx_cleanup` (`expires_at`, `used_at`),
  CONSTRAINT `fk_password_reset_tokens_usuario` 
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Create two_factor_codes table
-- ============================================================
CREATE TABLE IF NOT EXISTS `two_factor_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `code_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `verified_at` DATETIME NULL DEFAULT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_usuario_id` (`usuario_id`),
  INDEX `idx_code_hash` (`code_hash`),
  INDEX `idx_expires_at` (`expires_at`),
  INDEX `idx_cleanup` (`expires_at`, `verified_at`),
  CONSTRAINT `fk_two_factor_codes_usuario` 
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. Create default admin role if not exists
-- ============================================================
INSERT IGNORE INTO `roles` (`nombre`, `descripcion`, `created_at`, `updated_at`) 
VALUES ('admin', 'Administrator role with full access', NOW(), NOW());

-- ============================================================
-- 6. Create default permissions if not exist
-- ============================================================
INSERT IGNORE INTO `permisos` (`clave`, `descripcion`, `created_at`, `updated_at`) 
VALUES 
  ('admin:*', 'Full admin access', NOW(), NOW()),
  ('api:access', 'API access permission', NOW(), NOW()),
  ('docs:read', 'Read API documentation', NOW(), NOW()),
  ('crud:*:*', 'Full CRUD access to all tables', NOW(), NOW()),
  ('apikeys:read', 'Read API keys', NOW(), NOW()),
  ('apikeys:write', 'Create/update API keys', NOW(), NOW()),
  ('apikeys:delete', 'Delete API keys', NOW(), NOW()),
  ('webhooks:read', 'Read webhooks', NOW(), NOW()),
  ('webhooks:write', 'Create/update webhooks', NOW(), NOW()),
  ('webhooks:delete', 'Delete webhooks', NOW(), NOW()),
  ('eventos:read', 'Read eventos', NOW(), NOW()),
  ('eventos:write', 'Create eventos', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at=NOW();

-- ============================================================
-- 7. Assign permissions to admin role
-- ============================================================
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`, `created_at`, `updated_at`)
SELECT r.id, p.id, NOW(), NOW()
FROM `roles` r
CROSS JOIN `permisos` p
WHERE r.nombre = 'admin'
  AND p.clave IN ('admin:*', 'api:access', 'docs:read', 'crud:*:*', 
                  'apikeys:read', 'apikeys:write', 'apikeys:delete',
                  'webhooks:read', 'webhooks:write', 'webhooks:delete',
                  'eventos:read', 'eventos:write')
ON DUPLICATE KEY UPDATE updated_at=NOW();

-- ============================================================
-- 8. Update existing users to have admin role if they don't have one
-- ============================================================
UPDATE `usuarios` u
SET u.rol_id = (SELECT id FROM `roles` WHERE nombre = 'admin' LIMIT 1)
WHERE u.rol_id IS NULL;

-- ============================================================
-- 9. Ensure roles_permisos has timestamps
-- ============================================================
ALTER TABLE `roles_permisos`
ADD COLUMN IF NOT EXISTS `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ============================================================
-- 10. Ensure permisos has timestamps  
-- ============================================================
ALTER TABLE `permisos`
ADD COLUMN IF NOT EXISTS `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ============================================================
-- DONE - Schema is now ready for production!
-- ============================================================
