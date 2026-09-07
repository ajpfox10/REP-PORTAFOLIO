-- Crea la base tecnica del sistema. El nombre visible puede ser "Archivo Pasivo".
CREATE DATABASE IF NOT EXISTS `archivo_pasivo`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `archivo_pasivo`;

-- Roles principales. Cada usuario usa un solo rol.
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permisos finos que protegen rutas y acciones.
CREATE TABLE IF NOT EXISTS permisos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(120) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relacion entre roles y permisos.
CREATE TABLE IF NOT EXISTS roles_permisos (
  rol_id INT NOT NULL,
  permiso_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol_id, permiso_id),
  CONSTRAINT fk_roles_permisos_rol FOREIGN KEY (rol_id) REFERENCES roles(id),
  CONSTRAINT fk_roles_permisos_permiso FOREIGN KEY (permiso_id) REFERENCES permisos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usuarios locales del sistema administrativo.
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  nombre VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol_id INT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT NOT NULL DEFAULT 1,
  two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
  two_factor_secret VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens hasheados para logout real y rotacion segura.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by BIGINT NULL,
  ip VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_refresh_usuario_activo (usuario_id, revoked_at),
  INDEX idx_refresh_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contador de intentos fallidos por IP e identificador.
CREATE TABLE IF NOT EXISTS auth_login_guard (
  ip VARCHAR(80) NOT NULL,
  identifier VARCHAR(190) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_attempt_at DATETIME NULL,
  PRIMARY KEY (ip, identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bloqueos temporales para incidentes de seguridad.
CREATE TABLE IF NOT EXISTS security_bans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(80) NULL,
  usuario_email VARCHAR(190) NULL,
  reason VARCHAR(255) NOT NULL,
  banned_until DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_security_bans_until (banned_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auditoria de acciones sensibles y escrituras.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(80) NULL,
  usuario_id INT NULL,
  ip VARCHAR(80) NULL,
  method VARCHAR(12) NULL,
  route VARCHAR(255) NULL,
  status_code INT NULL,
  duration_ms INT NULL,
  action VARCHAR(120) NOT NULL,
  entity VARCHAR(120) NOT NULL,
  request_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_usuario (usuario_id),
  INDEX idx_audit_entity (entity),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Perfiles iniciales del sistema.
INSERT INTO roles (nombre, descripcion) VALUES
  ('ADMIN', 'Administracion completa del sistema'),
  ('OPERADOR', 'Carga y gestion operativa'),
  ('LECTOR', 'Consulta sin escritura')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Permisos iniciales, todos expresados como modulo:accion.
INSERT INTO permisos (clave, descripcion) VALUES
  ('usuarios:leer', 'Ver usuarios'),
  ('usuarios:crear', 'Crear usuarios'),
  ('usuarios:editar', 'Editar usuarios'),
  ('usuarios:eliminar', 'Eliminar usuarios'),
  ('roles:leer', 'Ver roles'),
  ('roles:editar', 'Editar roles'),
  ('permisos:leer', 'Ver permisos'),
  ('archivo_pasivo:leer', 'Consultar registros de archivo pasivo'),
  ('archivo_pasivo:crear', 'Crear registros de archivo pasivo'),
  ('archivo_pasivo:editar', 'Editar registros de archivo pasivo'),
  ('archivo_pasivo:eliminar', 'Eliminar registros de archivo pasivo'),
  ('auditoria:leer', 'Ver auditoria')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ADMIN recibe todos los permisos iniciales.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p WHERE r.nombre = 'ADMIN';

-- OPERADOR recibe permisos de trabajo operativo.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('archivo_pasivo:leer', 'archivo_pasivo:crear', 'archivo_pasivo:editar')
WHERE r.nombre = 'OPERADOR';

-- LECTOR recibe permisos de consulta.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('archivo_pasivo:leer')
WHERE r.nombre = 'LECTOR';
