-- ============================================================
-- Migration: 010__papcolpo_examen_prexamen.sql
-- Descripción: Tablas de Papanicolaou/Colposcopía, Examen y Pre-examen.
--              Cargadas por Jefe de Servicio; visibles por SAMO.
-- Idempotente: usa IF NOT EXISTS / INSERT IGNORE.
-- ============================================================

-- ── Tabla papcolpo ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `papcolpo` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `dni`            INT              NOT NULL,
  `fecha`          DATE             NOT NULL,
  `tipo`           ENUM('PAP','COLPO','PAP_COLPO') NOT NULL DEFAULT 'PAP',
  `resultado`      VARCHAR(500)     NULL,
  `observaciones`  TEXT             NULL,
  `jefe_nombre`    VARCHAR(190)     NULL,
  `sector_id`      INT UNSIGNED     NULL,
  `created_by`     BIGINT UNSIGNED  NULL,
  `created_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME         NULL,
  `deleted_by`     BIGINT UNSIGNED  NULL,
  PRIMARY KEY (`id`),
  KEY `ix_papcolpo_dni`     (`dni`),
  KEY `ix_papcolpo_sector`  (`sector_id`),
  KEY `ix_papcolpo_fecha`   (`fecha`),
  KEY `ix_papcolpo_deleted` (`deleted_at`),
  CONSTRAINT `fk_papcolpo_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla examen ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `examen` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `dni`            INT              NOT NULL,
  `fecha`          DATE             NOT NULL,
  `tipo`           VARCHAR(190)     NULL,
  `resultado`      VARCHAR(500)     NULL,
  `observaciones`  TEXT             NULL,
  `jefe_nombre`    VARCHAR(190)     NULL,
  `sector_id`      INT UNSIGNED     NULL,
  `created_by`     BIGINT UNSIGNED  NULL,
  `created_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME         NULL,
  `deleted_by`     BIGINT UNSIGNED  NULL,
  PRIMARY KEY (`id`),
  KEY `ix_examen_dni`     (`dni`),
  KEY `ix_examen_sector`  (`sector_id`),
  KEY `ix_examen_fecha`   (`fecha`),
  KEY `ix_examen_deleted` (`deleted_at`),
  CONSTRAINT `fk_examen_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla prexamen ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `prexamen` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `dni`            INT              NOT NULL,
  `fecha`          DATE             NOT NULL,
  `tipo`           VARCHAR(190)     NULL,
  `resultado`      VARCHAR(500)     NULL,
  `observaciones`  TEXT             NULL,
  `jefe_nombre`    VARCHAR(190)     NULL,
  `sector_id`      INT UNSIGNED     NULL,
  `created_by`     BIGINT UNSIGNED  NULL,
  `created_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME         NULL,
  `deleted_by`     BIGINT UNSIGNED  NULL,
  PRIMARY KEY (`id`),
  KEY `ix_prexamen_dni`     (`dni`),
  KEY `ix_prexamen_sector`  (`sector_id`),
  KEY `ix_prexamen_fecha`   (`fecha`),
  KEY `ix_prexamen_deleted` (`deleted_at`),
  CONSTRAINT `fk_prexamen_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permisos ─────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `permisos` (clave) VALUES
  ('crud:papcolpo:read'),
  ('crud:papcolpo:create'),
  ('crud:papcolpo:update'),
  ('crud:papcolpo:delete'),
  ('crud:examen:read'),
  ('crud:examen:create'),
  ('crud:examen:update'),
  ('crud:examen:delete'),
  ('crud:prexamen:read'),
  ('crud:prexamen:create'),
  ('crud:prexamen:update'),
  ('crud:prexamen:delete');

-- ── Rol jefe_servicio: leer y crear (no update/delete — solo admin) ──────────
INSERT IGNORE INTO `roles_permisos` (rol_id, permiso_id)
SELECT r.id, p.id
FROM `roles` r
CROSS JOIN `permisos` p
WHERE r.nombre = 'jefe_servicio'
  AND p.clave IN (
    'crud:papcolpo:read',  'crud:papcolpo:create',
    'crud:examen:read',    'crud:examen:create',
    'crud:prexamen:read',  'crud:prexamen:create'
  );

-- ── Rol samo: solo lectura ────────────────────────────────────────────────────
INSERT IGNORE INTO `roles_permisos` (rol_id, permiso_id)
SELECT r.id, p.id
FROM `roles` r
CROSS JOIN `permisos` p
WHERE r.nombre = 'samo'
  AND p.clave IN (
    'crud:papcolpo:read',
    'crud:examen:read',
    'crud:prexamen:read'
  );
