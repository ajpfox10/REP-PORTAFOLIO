-- 092: vacaciones adelantadas (pedido 24/10/2026).
--   Una fila por adelanto: de qué fecha a qué fecha, cuántos días y a qué año de vacaciones se imputa.
--   servicio_id / dependencia_id son la foto del destino del agente al momento de la carga, así se
--   puede buscar por servicio o dependencia aunque después lo cambien de lugar.
--   Auditoría: created_by (quién la cargó), updated_by (último que la editó), deleted_by (quién la
--   borró); borrado lógico con deleted_at, todos con FK a usuarios.
CREATE TABLE IF NOT EXISTS vacaciones_adelantadas (
  id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni             INT NOT NULL,
  agente_id       INT NULL COMMENT 'tramo de agentes vigente al cargar el adelanto',
  fecha_desde     DATE NOT NULL,
  fecha_hasta     DATE NOT NULL,
  dias            SMALLINT UNSIGNED NOT NULL,
  anio_imputado   SMALLINT UNSIGNED NOT NULL COMMENT 'año de vacaciones al que se descuenta el adelanto',
  servicio_id     INT NULL COMMENT 'servicio del agente al cargar',
  dependencia_id  INT NULL COMMENT 'dependencia del agente al cargar',
  observaciones   TEXT NULL,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  created_by      INT NULL,
  updated_by      INT NULL,
  deleted_by      INT NULL,
  KEY idx_vac_adel_dni (dni),
  KEY idx_vac_adel_servicio (servicio_id),
  KEY idx_vac_adel_dependencia (dependencia_id),
  KEY idx_vac_adel_fechas (fecha_desde, fecha_hasta),
  KEY idx_vac_adel_anio (anio_imputado),
  CONSTRAINT chk_vac_adel_fechas CHECK (fecha_hasta >= fecha_desde),
  CONSTRAINT fk_vac_adel_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_vac_adel_agente FOREIGN KEY (agente_id) REFERENCES agentes(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_vac_adel_servicio FOREIGN KEY (servicio_id) REFERENCES servicios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_vac_adel_dependencia FOREIGN KEY (dependencia_id) REFERENCES dependencias(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_vac_adel_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_vac_adel_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_vac_adel_deleted_by FOREIGN KEY (deleted_by) REFERENCES usuarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
