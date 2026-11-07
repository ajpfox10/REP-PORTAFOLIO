-- 101__examenes_medicos_fecha_origen.sql
-- De dónde sale la fecha del examen:
--   'siape'       -> FECHA de la exportación / grilla de SIAPE
--   'certificado' -> SIAPE no tiene FECHA (ej. DI-063742): el robot de certificados
--                    baja el PDF y toma "La Plata, <día> de <mes> de <año>".
--                    OJO: es la fecha de EMISIÓN del certificado (~1 mes después
--                    del examen). Si después SIAPE trae la fecha, la pisa.
-- NO idempotente (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS): verificar antes de re-aplicar.

ALTER TABLE examenes_medicos_siape
  ADD COLUMN fecha_origen VARCHAR(20) NULL AFTER fecha;

UPDATE examenes_medicos_siape SET fecha_origen = 'siape' WHERE fecha IS NOT NULL;
