-- 045__stress_carga_tables.sql
-- Automatizacion de carga de ANUAL COMPLEMENTARIA (stress post-vacacional) en SIAPE.
--   cola_carga_stress : snapshot de los >=90 dias a cargar (lo llena el orquestador Node cada corrida).
--   stress_cargados   : ledger anti-duplicado (dni+anio ya cargados por el robot en SIAPE).
-- El ledger es clave porque el `historial` no refleja la carga hasta la proxima importacion.

CREATE TABLE IF NOT EXISTS stress_cargados (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni INT NOT NULL,
  anio SMALLINT NOT NULL,
  dias INT NULL,
  licencia VARCHAR(60) NULL,
  cargado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stress_cargados__dni_anio (dni, anio),
  KEY idx_stress_cargados__dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cola_carga_stress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni INT NOT NULL,
  apellido VARCHAR(160) NULL,
  anio SMALLINT NOT NULL,
  dias INT NULL,
  licencia VARCHAR(60) NULL,
  ley VARCHAR(120) NULL,
  dias_transcurridos INT NULL,
  estado ENUM('pendiente','cargado','error','omitido') NOT NULL DEFAULT 'pendiente',
  motivo VARCHAR(255) NULL,
  creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cola_carga_stress__dni_anio (dni, anio),
  KEY idx_cola_carga_stress__estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
