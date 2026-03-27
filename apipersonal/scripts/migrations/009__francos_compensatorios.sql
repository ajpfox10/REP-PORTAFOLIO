-- ============================================================
-- Migration: 009__francos_compensatorios.sql
-- Descripción: Tabla de francos compensatorios cargados por jefes de servicio.
-- Idempotente: usa IF NOT EXISTS / INSERT IGNORE.
-- ============================================================

-- ── Tabla francos_compensatorios ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `francos_compensatorios` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `dni`            INT              NOT NULL,
  `fecha_franco`   DATE             NOT NULL,              -- día que se toma el franco
  `fecha_trabajo`  DATE             NULL,                  -- día extra trabajado que lo origina
  `motivo`         VARCHAR(500)     NULL,                  -- motivo / descripción
  `estado`         ENUM('PENDIENTE','APROBADO','TOMADO','ANULADO')
                   NOT NULL DEFAULT 'PENDIENTE',
  `jefe_nombre`    VARCHAR(190)     NULL,                  -- jefe que lo cargó
  `sector_id`      INT UNSIGNED     NULL,                  -- sector del jefe
  `observaciones`  TEXT             NULL,
  `created_by`     BIGINT UNSIGNED  NULL,                  -- usuario que lo creó
  `created_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME         NULL,                  -- soft delete
  PRIMARY KEY (`id`),
  KEY `ix_fc_dni`     (`dni`),
  KEY `ix_fc_sector`  (`sector_id`),
  KEY `ix_fc_fecha`   (`fecha_franco`),
  KEY `ix_fc_estado`  (`estado`),
  KEY `ix_fc_deleted` (`deleted_at`),
  CONSTRAINT `fk_fc_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permisos para francos_compensatorios ────────────────────────────────────
INSERT IGNORE INTO `permisos` (clave) VALUES
  ('crud:francos_compensatorios:read'),
  ('crud:francos_compensatorios:create'),
  ('crud:francos_compensatorios:update'),
  ('crud:francos_compensatorios:delete');

-- ── Rol jefe_servicio (si no existe) ────────────────────────────────────────
INSERT IGNORE INTO `roles` (nombre, descripcion)
VALUES ('jefe_servicio', 'Jefe de servicio — gestión de su sector');

-- ── Asignar permisos al rol jefe_servicio ───────────────────────────────────
-- Lee: puede ver los francos de su sector
-- Crea: puede cargar un nuevo franco
-- NO tiene update/delete (solo admin puede modificar estado)
INSERT IGNORE INTO `roles_permisos` (rol_id, permiso_id)
SELECT r.id, p.id
FROM `roles` r
CROSS JOIN `permisos` p
WHERE r.nombre  = 'jefe_servicio'
  AND p.clave IN (
    'crud:francos_compensatorios:read',
    'crud:francos_compensatorios:create'
  );
