-- 041__art_queue_exclude_reemplazo.sql
-- Excluye del enqueue automático de ART a los agentes cuya LEY es de reemplazo
-- (ej. "REEMPLAZO PEDIATRIA" id 15, "REEMPLAZOS" id 17). Los reemplazantes NO van a ART.
-- Recrea los triggers AFTER INSERT / AFTER UPDATE agregando la condición por nombre de ley
-- (UPPER(ley.nombre) LIKE '%REEMPLAZ%' cubre REEMPLAZO, REEMPLAZOS y cualquier variante futura).

DROP TRIGGER IF EXISTS trg_art_alta_queue_agentes_ai;
DROP TRIGGER IF EXISTS trg_art_alta_queue_agentes_au;

CREATE TRIGGER trg_art_alta_queue_agentes_ai
AFTER INSERT ON agentes
FOR EACH ROW
BEGIN
  IF NEW.estado_empleo = 'ACTIVO'
     AND NOT EXISTS (
       SELECT 1 FROM ley l WHERE l.id = NEW.ley_id AND UPPER(l.nombre) LIKE '%REEMPLAZ%'
     ) THEN
    INSERT INTO art_alta_queue
      (agente_id, dni, fecha_ingreso_db, estado_empleo, status, created_at, updated_at)
    VALUES
      (NEW.id, NEW.dni, NEW.fecha_ingreso, NEW.estado_empleo, 'PENDING', NOW(), NOW())
    ON DUPLICATE KEY UPDATE estado_empleo = NEW.estado_empleo, updated_at = NOW();
  END IF;
END;

CREATE TRIGGER trg_art_alta_queue_agentes_au
AFTER UPDATE ON agentes
FOR EACH ROW
BEGIN
  IF NEW.estado_empleo = 'ACTIVO'
     AND (OLD.estado_empleo IS NULL OR OLD.estado_empleo <> 'ACTIVO')
     AND NOT EXISTS (
       SELECT 1 FROM ley l WHERE l.id = NEW.ley_id AND UPPER(l.nombre) LIKE '%REEMPLAZ%'
     ) THEN
    INSERT INTO art_alta_queue
      (agente_id, dni, fecha_ingreso_db, estado_empleo, status, created_at, updated_at)
    VALUES
      (NEW.id, NEW.dni, NEW.fecha_ingreso, NEW.estado_empleo, 'PENDING', NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      estado_empleo = NEW.estado_empleo,
      status     = IF(art_alta_queue.status IN ('DONE','PROCESSING'), art_alta_queue.status, 'PENDING'),
      attempts   = IF(art_alta_queue.status IN ('DONE','PROCESSING'), art_alta_queue.attempts, 0),
      last_error = IF(art_alta_queue.status IN ('DONE','PROCESSING'), art_alta_queue.last_error, NULL),
      locked_at  = NULL,
      updated_at = NOW();
  END IF;
END;
