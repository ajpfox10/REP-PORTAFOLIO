-- 102__examenes_medicos_certificado.sql
-- Qué examen ya tiene su certificado bajado a DOCU\<dni>\Certificado Apto Psicofisico.
-- El robot de certificados baja el APTO más nuevo de cada agente si todavía no lo
-- tiene (vencido -> vuelve a estar vigente con un examen nuevo -> se baja ese).
-- NO idempotente (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS): verificar antes de re-aplicar.

ALTER TABLE examenes_medicos_siape
  ADD COLUMN certificado_archivo VARCHAR(300) NULL AFTER archivo,
  ADD COLUMN certificado_bajado DATETIME NULL AFTER certificado_archivo;
