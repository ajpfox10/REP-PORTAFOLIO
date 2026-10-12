-- Tiempo Acumulado de SIAPE (saldo de licencias por agente/año) en tabla.
-- Fuente: consulta 13 "Tiempo Acumulado" del Gestor de Exportaciones de SIAPE
-- (robot siape_exportaciones/descargar_exportacion_siape.py). La consulta NO trae
-- las filas en 0 dias: las que ya estaban y dejan de venir se ponen en 0
-- (origen='inferido_0', solo agentes ACTIVOS). Carga inicial desde el .xls de
-- Discoverer (que si trae los ceros), origen='discoverer'.
-- La leen: carga de stress (cargar_stress.mjs), /licencias y /residentes.
CREATE TABLE IF NOT EXISTS tiempo_acumulado (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  dni              INT NOT NULL,
  anio             SMALLINT NOT NULL,
  licencia         VARCHAR(120) NOT NULL,
  regimen          VARCHAR(80)  NOT NULL DEFAULT '',
  planta           VARCHAR(80)  NOT NULL DEFAULT '',
  seq              TINYINT      NOT NULL DEFAULT 1,      -- SIAPE repite filas identicas (2 complementarias): orden dentro del grupo
  dias             DECIMAL(6,1) NOT NULL DEFAULT 0,
  pasa             VARCHAR(5)   NULL,
  apellido_nombre  VARCHAR(160) NULL,                    -- "APELLIDO, NOMBRE" como Discoverer
  tipo_doc         VARCHAR(10)  NULL,
  legajo           VARCHAR(20)  NULL,
  estructura       VARCHAR(255) NULL,
  origen           ENUM('siape','discoverer','inferido_0') NOT NULL DEFAULT 'siape',
  en_ultima_bajada TINYINT(1)   NOT NULL DEFAULT 1,      -- vino en la ultima bajada de ese año
  visto_en         DATETIME     NULL,                    -- ultima bajada en la que vino
  actualizado_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tiempo_acumulado (dni, anio, licencia, regimen, planta, seq),
  KEY idx_tiempo_acumulado_anio (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
