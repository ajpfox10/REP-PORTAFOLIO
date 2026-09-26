-- 050__jubilacion_expediente_ips.sql
--
-- Expediente del IPS en el trámite jubilatorio:
--   · posibles_jubilados.expediente_ips → el número de expediente.
--   · un sexto paso en el checklist de carga, al final (después de Resolución).
--
-- Las dos cosas también se aplican solas en runtime desde jubilacion.routes.ts
-- (ensurePosiblesColumns / ensureChecklistTables). Esta es la DDL canónica.

ALTER TABLE posibles_jubilados
  ADD COLUMN expediente_ips varchar(60) NULL AFTER fecha_jubilacion;

ALTER TABLE posibles_jubilados_checklist
  MODIFY item enum('DOCUMENTACION','IFGRA','SIAPE','INTRANET','RESOLUCION','EXPEDIENTE_IPS') NOT NULL;
