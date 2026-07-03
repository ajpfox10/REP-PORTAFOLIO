-- 030__practicas_profesionales.sql
-- Registro de practicas profesionales cargadas por jefe de servicio.
-- Regla: solo se admiten 1 a 10 dias por registro.

CREATE TABLE IF NOT EXISTS `practicas_profesionales` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dni`            INT             NOT NULL,
  `fecha_desde`    DATE            NOT NULL,
  `dias`           INT             NOT NULL,
  `motivo`         VARCHAR(500)    NULL,
  `observaciones`  TEXT            NULL,
  `sector_id`      INT UNSIGNED    NULL,
  `jefe_nombre`    VARCHAR(190)    NULL,
  `estado`         ENUM('PENDIENTE','APROBADO','RECHAZADO','ANULADO') NOT NULL DEFAULT 'PENDIENTE',
  `created_by`     BIGINT UNSIGNED NULL,
  `created_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME        NULL,
  `deleted_by`     BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_practicas_dni` (`dni`),
  KEY `idx_practicas_sector` (`sector_id`),
  KEY `idx_practicas_fecha` (`fecha_desde`),
  KEY `idx_practicas_deleted` (`deleted_at`),
  CONSTRAINT `chk_practicas_dias_1_10` CHECK (`dias` BETWEEN 1 AND 10),
  CONSTRAINT `fk_practicas_personal_dni`
    FOREIGN KEY (`dni`) REFERENCES `personal` (`dni`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permisos (clave, descripcion)
VALUES
  ('crud:practicas_profesionales:read',   'Leer practicas profesionales'),
  ('crud:practicas_profesionales:create', 'Crear practicas profesionales'),
  ('crud:practicas_profesionales:update', 'Actualizar practicas profesionales'),
  ('crud:practicas_profesionales:delete', 'Eliminar practicas profesionales');

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN (
  'crud:practicas_profesionales:read',
  'crud:practicas_profesionales:create',
  'crud:practicas_profesionales:update',
  'crud:practicas_profesionales:delete'
)
WHERE r.nombre IN ('jefe_servicio', 'Jefe con acceso a SAMO')
  AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL;

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave = 'crud:practicas_profesionales:read'
WHERE r.nombre = 'samo'
  AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL;
