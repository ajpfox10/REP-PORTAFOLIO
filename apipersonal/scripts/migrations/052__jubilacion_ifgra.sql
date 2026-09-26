-- 052__jubilacion_ifgra.sql
--
-- Los dos informes graficos (IFGRA) del tramite jubilatorio.
--
-- Se piden al tildar el paso IFGRA del checklist y se guardan en dos lados:
--   · posibles_jubilados.ifgra_1 / ifgra_2 → el dato del tramite (chip y checklist).
--   · una fila en `expedientes` por cada uno (dni + numero + caratula
--     'JUBILACION - INFORME GRAFICO 1/2'), que es donde los ve la pagina del
--     agente. Lo mismo hacen los pasos EXPEDIENTE_GDEBA y EXPEDIENTE_IPS.
--
-- Las columnas tambien se agregan solas en runtime desde jubilacion.routes.ts
-- (ensurePosiblesColumns). Esta es la DDL canonica.

ALTER TABLE posibles_jubilados
  ADD COLUMN ifgra_1 varchar(60) NULL AFTER expediente_gdeba,
  ADD COLUMN ifgra_2 varchar(60) NULL AFTER ifgra_1;
