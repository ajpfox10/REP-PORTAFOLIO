-- 067__art_baja_queue.sql
-- Baja automática en ProvinciART: cuando un tramo de agentes PASA a 'BAJA' se encola el DNI.
-- Lo procesa el robot scripts/art_baja_trabajador.mjs (página Robots, corrida nocturna), que
-- ANTES de tocar ART vuelve a chequear que el DNI no tenga ningún tramo vigente: al cerrar un
-- tramo por cambio de ocupación / beca→nombramiento el tramo nuevo se crea después, así que en
-- el momento del trigger no se puede saber si es una baja real.
-- 1 fila por DNI (en ART la persona es una sola aunque tenga varios tramos). Si vuelve a
-- entrar y a salir, la fila se reabre en PENDING.
-- Solo AFTER UPDATE: los INSERT en BAJA son carga de historia (tramos viejos), no bajas nuevas.
-- Los reemplazantes (ley '%REEMPLAZ%') no van a ART, tampoco a la baja.

CREATE TABLE IF NOT EXISTS art_baja_queue (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni          INT NOT NULL,
  agente_id    INT NULL COMMENT 'tramo que pasó a BAJA y disparó el encolado',
  status       ENUM('PENDING','PROCESSING','DONE','ERROR','SKIPPED') NOT NULL DEFAULT 'PENDING',
  resultado    VARCHAR(20) NULL COMMENT 'BAJA_OK / NO_EN_ART / SIGUE_ACTIVO',
  fecha_baja_art DATE NULL COMMENT 'F. Egreso Empresa que se cargó en ART',
  trabajador_id INT NULL COMMENT 'id del trabajador en ProvinciART',
  attempts     INT NOT NULL DEFAULT 0,
  locked_at    DATETIME NULL,
  finished_at  DATETIME NULL,
  last_error   TEXT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_art_baja_queue_dni (dni),
  KEY idx_art_baja_queue_status (status, attempts, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS trg_art_baja_queue_agentes_au;

CREATE TRIGGER trg_art_baja_queue_agentes_au
AFTER UPDATE ON agentes
FOR EACH ROW
BEGIN
  IF NEW.estado_empleo = 'BAJA'
     AND (OLD.estado_empleo IS NULL OR OLD.estado_empleo <> 'BAJA')
     AND NOT EXISTS (
       SELECT 1 FROM ley l WHERE l.id = NEW.ley_id AND UPPER(l.nombre) LIKE '%REEMPLAZ%'
     ) THEN
    INSERT INTO art_baja_queue (dni, agente_id, status, created_at, updated_at)
    VALUES (NEW.dni, NEW.id, 'PENDING', NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      agente_id  = NEW.id,
      status     = IF(art_baja_queue.status = 'PROCESSING', art_baja_queue.status, 'PENDING'),
      resultado  = IF(art_baja_queue.status = 'PROCESSING', art_baja_queue.resultado, NULL),
      attempts   = IF(art_baja_queue.status = 'PROCESSING', art_baja_queue.attempts, 0),
      last_error = IF(art_baja_queue.status = 'PROCESSING', art_baja_queue.last_error, NULL),
      created_at = NOW(),
      updated_at = NOW();
  END IF;
END;
