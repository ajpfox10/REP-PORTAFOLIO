USE `archivo_pasivo`;

-- Configuracion simple editable por administracion.
CREATE TABLE IF NOT EXISTS app_settings (
  clave VARCHAR(120) PRIMARY KEY,
  valor VARCHAR(500) NOT NULL,
  descripcion VARCHAR(255) NULL,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historias clinicas marcadas para control del archivo pasivo.
CREATE TABLE IF NOT EXISTS historias_clinicas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  dni VARCHAR(20) NOT NULL,
  apellido_nombre VARCHAR(180) NOT NULL,
  fecha_ultimo_movimiento DATE NOT NULL,
  caja VARCHAR(80) NULL,
  comentarios TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_hc_dni (dni),
  INDEX idx_hc_ultimo_movimiento (fecha_ultimo_movimiento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pedidos de historias clinicas realizados por usuarios autorizados.
CREATE TABLE IF NOT EXISTS pedidos_historias_clinicas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  historia_clinica_id BIGINT NULL,
  dni VARCHAR(20) NOT NULL,
  apellido_nombre VARCHAR(180) NOT NULL,
  fecha_ultimo_movimiento DATE NOT NULL,
  comentarios TEXT NULL,
  fecha_pedido DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  solicitado_por INT NULL,
  resuelto TINYINT(1) NOT NULL DEFAULT 0,
  fecha_resuelto DATETIME NULL,
  resuelto_por INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pedidos_hc_hc FOREIGN KEY (historia_clinica_id) REFERENCES historias_clinicas(id),
  CONSTRAINT fk_pedidos_hc_solicitado_por FOREIGN KEY (solicitado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_pedidos_hc_resuelto_por FOREIGN KEY (resuelto_por) REFERENCES usuarios(id),
  INDEX idx_pedidos_hc_dni (dni),
  INDEX idx_pedidos_hc_resuelto (resuelto),
  INDEX idx_pedidos_hc_fecha_pedido (fecha_pedido)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trigger para sellar fecha de resolucion cuando el pedido pasa a resuelto.
DROP TRIGGER IF EXISTS trg_pedidos_hc_resuelto_bu;
DELIMITER $$
CREATE TRIGGER trg_pedidos_hc_resuelto_bu
BEFORE UPDATE ON pedidos_historias_clinicas
FOR EACH ROW
BEGIN
  IF NEW.resuelto = 1 AND OLD.resuelto = 0 THEN
    SET NEW.fecha_resuelto = COALESCE(NEW.fecha_resuelto, NOW());
  END IF;
  IF NEW.resuelto = 0 THEN
    SET NEW.fecha_resuelto = NULL;
    SET NEW.resuelto_por = NULL;
  END IF;
END$$
DELIMITER ;

-- Valores iniciales editables por admin.
INSERT INTO app_settings (clave, valor, descripcion) VALUES
  ('hc_anios_sin_movimiento_menor', '5', 'Primer umbral de historias clinicas sin movimiento'),
  ('hc_anios_sin_movimiento_mayor', '10', 'Segundo umbral de historias clinicas sin movimiento'),
  ('hc_etiqueta_ancho_mm', '64', 'Ancho de etiqueta HC en milimetros'),
  ('hc_etiqueta_alto_mm', '36', 'Alto de etiqueta HC en milimetros'),
  ('hc_etiqueta_fuente_pt', '8', 'Tamanio de letra de etiqueta HC en puntos')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Permisos del modulo.
INSERT INTO permisos (clave, descripcion) VALUES
  ('hc:leer', 'Ver historial de historias clinicas'),
  ('hc:crear', 'Cargar historias clinicas'),
  ('hc:pedir', 'Solicitar historias clinicas al archivo pasivo'),
  ('hc:configurar', 'Configurar criterios de historias clinicas'),
  ('pedidos_hc:leer', 'Ver pedidos de historias clinicas'),
  ('pedidos_hc:resolver', 'Marcar pedidos de historias clinicas como resueltos'),
  ('cuenta:editar', 'Cambiar contrasena propia')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Rol especifico para legales.
INSERT INTO roles (nombre, descripcion) VALUES
  ('LEGALES', 'Puede consultar el historial de historias clinicas y generar pedidos')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ADMIN recibe todos los permisos nuevos.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'ADMIN'
  AND p.clave IN ('hc:leer','hc:crear','hc:pedir','hc:configurar','pedidos_hc:leer','pedidos_hc:resolver','cuenta:editar');

-- LEGALES puede consultar y pedir HC, y cambiar su contrasena.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('hc:leer','hc:pedir','pedidos_hc:leer','cuenta:editar')
WHERE r.nombre = 'LEGALES';

-- Los roles existentes tambien pueden cambiar su propia contrasena.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave = 'cuenta:editar'
WHERE r.nombre IN ('ADMIN','OPERADOR','LECTOR');
