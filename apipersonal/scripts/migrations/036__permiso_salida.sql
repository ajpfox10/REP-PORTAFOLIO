-- 036__permiso_salida.sql
-- Permiso de salida cargado por jefe de servicio.
-- Solo aplica a agentes becados (ley "beca"/"programa"); el filtro es del frontend.

CREATE TABLE IF NOT EXISTS `permiso_salida` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dni`            INT             NOT NULL,
  `fecha`          DATE            NOT NULL,
  `hora_desde`     TIME            NULL,
  `hora_hasta`     TIME            NULL,
  `motivo`         VARCHAR(500)    NULL,
  `observaciones`  TEXT            NULL,
  `jefe_nombre`    VARCHAR(190)    NULL,
  `sector_id`      INT UNSIGNED    NULL,
  `created_by`     BIGINT UNSIGNED NULL,
  `created_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME        NULL,
  `deleted_by`     BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_permiso_salida_dni` (`dni`),
  KEY `idx_permiso_salida_sector` (`sector_id`),
  KEY `idx_permiso_salida_fecha` (`fecha`),
  KEY `idx_permiso_salida_deleted` (`deleted_at`),
  CONSTRAINT `fk_permiso_salida_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal` (`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permisos (clave, descripcion)
VALUES
  ('crud:permiso_salida:read',   'Leer permisos de salida'),
  ('crud:permiso_salida:create', 'Crear permisos de salida'),
  ('crud:permiso_salida:update', 'Actualizar permisos de salida'),
  ('crud:permiso_salida:delete', 'Eliminar permisos de salida');

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN (
  'crud:permiso_salida:read',
  'crud:permiso_salida:create',
  'crud:permiso_salida:update',
  'crud:permiso_salida:delete'
)
WHERE r.nombre IN ('jefe_servicio', 'Jefe con acceso a SAMO')
  AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL;

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave = 'crud:permiso_salida:read'
WHERE r.nombre = 'samo'
  AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL;
