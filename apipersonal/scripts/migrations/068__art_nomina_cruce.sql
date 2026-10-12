-- 068__art_nomina_cruce.sql
-- Foto del padrón (nómina) de ProvinciART para cruzarlo con la base.
-- La llena scripts/art_bajar_nomina.mjs --db (reemplaza las filas de cada establecimiento que
-- baja). El cruce (a dar de baja / en ART y no en la base / en la base y no en ART) lo arma
-- GET /becarios-art/cruce y se ve en la pestaña "Cruce ART ↔ base" de Carga de ART.
-- dni: el de personal cuyo CUIL coincide; si no hay, el que sale del CUIL (posiciones 3-10).

CREATE TABLE IF NOT EXISTS art_nomina (
  establecimiento_id    VARCHAR(10)  NOT NULL,
  cuil                  CHAR(11)     NOT NULL COMMENT 'solo dígitos',
  dni                   INT          NULL,
  trabajador            VARCHAR(150) NULL COMMENT 'apellido y nombre como figura en ART',
  email                 VARCHAR(150) NULL,
  trabajador_id         INT          NULL COMMENT 'id del trabajador en ProvinciART',
  establecimiento_label VARCHAR(150) NULL,
  descargado_en         DATETIME     NOT NULL,
  PRIMARY KEY (establecimiento_id, cuil),
  KEY idx_art_nomina_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Quién encoló la baja: el trigger (pasó a BAJA) o el cruce con el padrón.
-- (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS: se agrega solo si falta.)
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'art_baja_queue' AND COLUMN_NAME = 'origen');
SET @sql := IF(@falta, "ALTER TABLE art_baja_queue ADD COLUMN origen VARCHAR(10) NOT NULL DEFAULT 'trigger' AFTER agente_id", 'DO 0');
PREPARE st FROM @sql;
EXECUTE st;
DEALLOCATE PREPARE st;
