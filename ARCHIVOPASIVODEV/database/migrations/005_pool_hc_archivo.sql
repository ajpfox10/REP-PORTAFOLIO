USE `archivo_pasivo`;

-- El pedido puede nacer desde Legales sin conocer todavia la ultima fecha real de movimiento.
ALTER TABLE pedidos_historias_clinicas
  MODIFY fecha_ultimo_movimiento DATE NULL;

-- Pool operativo de HC cargadas por Archivo. Es independiente de los pedidos.
CREATE TABLE IF NOT EXISTS pool_historias_clinicas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id BIGINT NULL,
  dni VARCHAR(20) NOT NULL,
  apellido_nombre VARCHAR(180) NOT NULL,
  fecha_ultimo_movimiento DATE NOT NULL,
  comentarios TEXT NULL,
  cargado_por INT NULL,
  fecha_carga DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  etiqueta_impresa TINYINT(1) NOT NULL DEFAULT 0,
  fecha_impresion DATETIME NULL,
  impreso_por INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pool_hc_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_historias_clinicas(id),
  CONSTRAINT fk_pool_hc_cargado_por FOREIGN KEY (cargado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_pool_hc_impreso_por FOREIGN KEY (impreso_por) REFERENCES usuarios(id),
  UNIQUE KEY uq_pool_hc_pedido (pedido_id),
  INDEX idx_pool_hc_dni (dni),
  INDEX idx_pool_hc_etiqueta_impresa (etiqueta_impresa),
  INDEX idx_pool_hc_fecha_movimiento (fecha_ultimo_movimiento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rol operativo de Archivo: ve pedidos, los resuelve y trabaja el pool de etiquetas.
INSERT INTO roles (nombre, descripcion) VALUES
  ('ARCHIVO', 'Resuelve pedidos de legales y carga HC al pool de etiquetas')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('hc:leer','pedidos_hc:leer','pedidos_hc:resolver','cuenta:editar')
WHERE r.nombre = 'ARCHIVO';

-- ADMIN tambien conserva acceso a la operatoria de pedidos/pool.
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('hc:leer','pedidos_hc:leer','pedidos_hc:resolver','cuenta:editar')
WHERE r.nombre = 'ADMIN';
