-- Pases a comisión de agentes (Gestión + página Herramientas → Comisiones).
-- Una fila por comisión. El pase cierra el tramo ACTIVO de `agentes` (estado COMISION,
-- fecha_egreso = fecha_desde) y el servicio/sector abiertos con esa misma fecha; el
-- regreso abre un tramo ACTIVO nuevo (clon del cerrado) con el servicio elegido.
-- Aplicada a mano el 13/10/2026 en personalv5 (base compartida dev/prod) y registrada
-- en schema_migrations.
CREATE TABLE IF NOT EXISTS agentes_comisiones (
  id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni                 INT NOT NULL,
  agente_id           INT NULL COMMENT 'tramo de agentes cerrado por la comisión',
  tipo_acto           VARCHAR(40) NULL COMMENT 'RESOLUCION / DISPOSICION / DECRETO / NOTA / OTRO',
  numero_acto         VARCHAR(80) NOT NULL,
  destino             VARCHAR(255) NOT NULL,
  fecha_desde         DATE NOT NULL,
  fecha_hasta         DATE NULL COMMENT 'vencimiento previsto (límite); NULL = sin plazo',
  servicio_origen_id  INT NULL,
  sector_origen_id    INT NULL,
  fecha_regreso       DATE NULL COMMENT 'NULL = comisión vigente',
  servicio_regreso_id INT NULL,
  sector_regreso_id   INT NULL,
  agente_regreso_id   INT NULL COMMENT 'tramo ACTIVO abierto al regresar',
  observaciones       TEXT NULL,
  created_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          DATETIME NULL,
  created_by          INT NULL,
  updated_by          INT NULL,
  KEY idx_agentes_comisiones_dni (dni),
  KEY idx_agentes_comisiones_vigentes (fecha_regreso, fecha_hasta),
  CONSTRAINT fk_agentes_comisiones_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_agentes_comisiones_agente FOREIGN KEY (agente_id) REFERENCES agentes(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_agente_regreso FOREIGN KEY (agente_regreso_id) REFERENCES agentes(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_srv_origen FOREIGN KEY (servicio_origen_id) REFERENCES servicios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_srv_regreso FOREIGN KEY (servicio_regreso_id) REFERENCES servicios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_sec_origen FOREIGN KEY (sector_origen_id) REFERENCES sectores(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_sec_regreso FOREIGN KEY (sector_regreso_id) REFERENCES sectores(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_agentes_comisiones_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
