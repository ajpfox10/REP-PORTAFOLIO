-- 046__descarga_tiempo_acumulado.sql
-- Estado de la descarga automática del Excel "Tiempo Acumulado" desde Oracle Discoverer.
-- Lo escribe scripts/siape_stress/bajar_tiempo_acumulado.mjs en cada corrida.
CREATE TABLE IF NOT EXISTS descarga_tiempo_acumulado (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estado ENUM('ok','error') NOT NULL,
  motivo VARCHAR(255) NULL,
  filas INT NULL,
  archivo VARCHAR(255) NULL,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_desc_ta__fecha (actualizado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
