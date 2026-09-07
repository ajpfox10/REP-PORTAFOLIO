USE `archivo_pasivo`;

-- Solicitudes publicas de acceso al sistema.
CREATE TABLE IF NOT EXISTS access_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  motivo VARCHAR(500) NULL,
  codigo_hash CHAR(64) NOT NULL,
  status ENUM('PENDIENTE', 'CONFIRMADA', 'APROBADA', 'RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
  confirmed_at DATETIME NULL,
  approved_at DATETIME NULL,
  approved_by INT NULL,
  expires_at DATETIME NOT NULL,
  ip VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_access_requests_email (email),
  INDEX idx_access_requests_status (status),
  INDEX idx_access_requests_expires (expires_at),
  CONSTRAINT fk_access_requests_approved_by FOREIGN KEY (approved_by) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tokens de reseteo de contrasena. Solo se guarda el hash del token.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  ip VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_password_reset_usuario (usuario_id),
  INDEX idx_password_reset_expires (expires_at),
  CONSTRAINT fk_password_reset_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permisos administrativos para revisar solicitudes de acceso.
INSERT INTO permisos (clave, descripcion) VALUES
  ('solicitudes:leer', 'Ver solicitudes de acceso'),
  ('solicitudes:editar', 'Aprobar o rechazar solicitudes de acceso')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('solicitudes:leer', 'solicitudes:editar')
WHERE r.nombre = 'ADMIN';
