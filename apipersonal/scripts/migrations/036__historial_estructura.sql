-- 036__historial_estructura.sql
-- Partes de plantel por agente scrapeadas de la Intranet MS (bot de
-- /app/historial-estructura, salida en D:\G\HISTORIAL ESTRUCTURA\historial*.xlsx).
-- Una fila por parte (BECAS / 10471-PLANTA / 10430... / HORAS CATEDRA) con
-- fecha de baja y cargo. dependencia = archivo de origen (HOSPITAL/UPA 4/UPA 18).
-- FK a personal: el listado del bot se genera desde personal, así que el DNI
-- siempre debería existir (las filas basura del bot con DNI inválido se saltean).
CREATE TABLE IF NOT EXISTS historial_estructura (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni INT NOT NULL,
  origen VARCHAR(10) NULL,
  legajo VARCHAR(30) NULL,
  nombre VARCHAR(150) NULL,
  apellido_nombre VARCHAR(150) NULL,
  parte VARCHAR(150) NULL,
  plantel VARCHAR(60) NULL,
  fecha_baja DATE NULL,
  cargo VARCHAR(500) NULL,
  estado VARCHAR(10) NULL,
  detalle VARCHAR(500) NULL,
  dependencia VARCHAR(20) NOT NULL,
  archivo_origen VARCHAR(150) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hestr__dni (dni),
  KEY idx_hestr__dependencia (dependencia),
  KEY idx_hestr__parte (parte),
  CONSTRAINT fk_hestr__personal_dni FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
