-- 129: tilde "Ley 14783" por agente en la tanda de trámites documentales.
-- 1 = el agente entra por la Ley 14783 → en "Documentación incompleta" se le pide
-- el Anexo 1 Ley 14783 y el certificado de nacimiento que lo acompaña. 0 = no se piden.
-- La API también agrega la columna sola al arrancar si falta (tramitesDocumentales.routes.ts).
-- NO idempotente: verificar con SHOW COLUMNS antes de re-aplicar.
ALTER TABLE tramites_tanda_interinos ADD COLUMN ley_14783 TINYINT(1) NOT NULL DEFAULT 0;
