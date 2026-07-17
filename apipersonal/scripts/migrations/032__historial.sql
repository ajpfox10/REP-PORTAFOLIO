-- 032__historial.sql
-- Historial de novedades/licencias SIAPE (exports anuales guardados en
-- D:\G\estadisticaasistencia\HISTORIAL). Una fila por registro del export.
-- dni está atado por FK a personal (PK) y a agentes (índice idx_agentes__dni):
-- los DNI que ya no existen en el sistema no se pueden cargar.
CREATE TABLE IF NOT EXISTS historial (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni INT NOT NULL,
  legajo VARCHAR(30) NULL,
  apellido VARCHAR(120) NULL,
  nombre VARCHAR(120) NULL,
  sexo VARCHAR(5) NULL,
  regimen_estatutario VARCHAR(120) NULL,
  planta VARCHAR(60) NULL,
  agrupamiento VARCHAR(80) NULL,
  categoria_salarial VARCHAR(30) NULL,
  novedad VARCHAR(160) NOT NULL,
  fecha_desde DATE NULL,
  fecha_hasta DATE NULL,
  justificado VARCHAR(5) NULL,
  estructura_servicio VARCHAR(255) NULL,
  dependencia VARCHAR(40) NULL,
  archivo_origen VARCHAR(150) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_historial__dni (dni),
  KEY idx_historial__novedad (novedad),
  KEY idx_historial__fecha_desde (fecha_desde),
  CONSTRAINT fk_historial__personal_dni FOREIGN KEY (dni) REFERENCES personal (dni),
  CONSTRAINT fk_historial__agentes_dni FOREIGN KEY (dni) REFERENCES agentes (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
