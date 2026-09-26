-- Registro genérico de corridas de scripts de automatización (robots SIAPE, etc.)
-- Cada script inserta una fila al terminar; la última fila por `script` es su estado actual.
CREATE TABLE IF NOT EXISTS script_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  script VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  estado ENUM('ok','error') NOT NULL,
  motivo VARCHAR(500) NULL,
  filas INT NULL,
  archivo VARCHAR(500) NULL,
  duracion_seg INT NULL,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_script_runs__script_fecha (script, actualizado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
