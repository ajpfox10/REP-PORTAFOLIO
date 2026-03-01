-- ============================================================
-- Migration: 008__completar_esquema_v11.sql
-- Descripción: Columnas y tablas que completan el esquema v11.
-- Idempotente: usa IF NOT EXISTS / IGNORE.
-- ============================================================

-- Asegurar que usuarios tenga la columna 'nombre' (puede faltar en instalaciones viejas)
ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `nombre` VARCHAR(190) NULL AFTER `email`;

-- Asegurar que personal tenga updated_at (migration 006 lo agrega, pero por si acaso)
ALTER TABLE `personal`
  ADD COLUMN IF NOT EXISTS `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  AFTER `created_at`;

-- Tabla para tokens de password reset
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64)        NOT NULL,
  `expires_at` DATETIME        NOT NULL,
  `used_at`    DATETIME        NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prt_token` (`token_hash`),
  KEY `ix_prt_usuario` (`usuario_id`),
  KEY `ix_prt_expires` (`expires_at`),
  CONSTRAINT `fk_prt_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Tabla de servicios (si no existe)
CREATE TABLE IF NOT EXISTS `servicios` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_servicios_nombre` (`nombre`)
) ENGINE=InnoDB;

-- Tabla de plantas (si no existe)
CREATE TABLE IF NOT EXISTS `plantas` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de categorías
CREATE TABLE IF NOT EXISTS `categorias` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `ley_id`     INT UNSIGNED NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de funciones
CREATE TABLE IF NOT EXISTS `funciones` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de ocupaciones
CREATE TABLE IF NOT EXISTS `ocupaciones` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de regímenes horarios
CREATE TABLE IF NOT EXISTS `regimenes_horarios` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de dependencias
CREATE TABLE IF NOT EXISTS `dependencias` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Tabla de sexos (catálogo)
CREATE TABLE IF NOT EXISTS `sexos` (
  `id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT IGNORE INTO `sexos` (id, nombre) VALUES (1,'Masculino'),(2,'Femenino'),(3,'No binario'),(4,'No especificado');

-- Tabla de ley (regímenes legales)
CREATE TABLE IF NOT EXISTS `ley` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`     VARCHAR(191) NOT NULL,
  `deleted_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- Permisos nuevos del v11
INSERT IGNORE INTO `permisos` (clave) VALUES
  ('admin:read'),
  ('admin:write'),
  ('personal:historial:read'),
  ('documents:write'),
  ('api_keys:read'),
  ('api_keys:write');

