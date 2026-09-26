-- 051__jubilacion_expediente_gdeba.sql
--
-- Expediente GDEBA en el tramite jubilatorio:
--   · posibles_jubilados.expediente_gdeba → el numero de expediente (EX-NNNNNNNN-GDEBA-AAAA).
--   · un septimo paso en el checklist de carga, entre IFGRA y SIAPE.
--
-- Los dos pasos de expediente (IPS y GDEBA) piden el numero al tildarse: el PUT
-- del checklist lo escribe en la columna de posibles_jubilados, y destildar la
-- deja en NULL.
--
-- Las dos cosas tambien se aplican solas en runtime desde jubilacion.routes.ts
-- (ensurePosiblesColumns / ensureChecklistTables). Esta es la DDL canonica.

ALTER TABLE posibles_jubilados
  ADD COLUMN expediente_gdeba varchar(60) NULL AFTER expediente_ips;

ALTER TABLE posibles_jubilados_checklist
  MODIFY item enum('DOCUMENTACION','IFGRA','EXPEDIENTE_GDEBA','SIAPE','INTRANET','RESOLUCION','EXPEDIENTE_IPS') NOT NULL;
