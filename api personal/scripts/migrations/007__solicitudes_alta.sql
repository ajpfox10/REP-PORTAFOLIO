-- ============================================================
-- Migration: 007__solicitudes_alta.sql
-- Tabla para solicitudes de alta de agentes (flujo sin admin)
-- ============================================================

CREATE TABLE IF NOT EXISTS `solicitudes_alta` (
  `id`               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  `dni`              BIGINT UNSIGNED   NOT NULL,
  `apellido`         VARCHAR(255)      NOT NULL,
  `nombre`           VARCHAR(255)      NOT NULL,
  `cuil`             VARCHAR(20)       NULL,
  `fecha_nacimiento` DATE              NULL,
  `email`            VARCHAR(255)      NULL,
  `telefono`         VARCHAR(50)       NULL,
  `estado_empleo`    VARCHAR(50)       NULL DEFAULT 'activo',
  `observaciones`    TEXT              NULL,
  `estado_solicitud` ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  `revisada_por`     INT               NULL COMMENT 'usuario_id del revisor',
  `revisada_at`      DATETIME          NULL,
  `motivo_rechazo`   TEXT              NULL,
  `created_by`       INT               NULL COMMENT 'usuario_id del solicitante',
  `created_at`       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME          NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_sa_estado` (`estado_solicitud`),
  INDEX `idx_sa_dni`    (`dni`),
  INDEX `idx_sa_created`(`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Permiso para ver y gestionar solicitudes
INSERT IGNORE INTO permisos (clave, descripcion, created_at) VALUES
  ('solicitudes_alta:read',   'Ver solicitudes de alta',             NOW()),
  ('solicitudes_alta:write',  'Aprobar/rechazar solicitudes de alta', NOW()),
  ('solicitudes_alta:create', 'Enviar solicitud de alta (usuario)',   NOW());

-- Dar al rol 1 (superadmin) los permisos de gestión
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id, created_at)
SELECT 1, p.id, NOW() FROM permisos p
WHERE p.clave IN ('solicitudes_alta:read','solicitudes_alta:write','solicitudes_alta:create')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = 1 AND rp.permiso_id = p.id);

-- Dar a todos los usuarios autenticados el permiso de crear solicitud (via rol 2 o similar)
-- Nota: ajustar el rol_id según la configuración de cada instalación
