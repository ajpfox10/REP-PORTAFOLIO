-- 130: tilde "Ley 10592" (discapacidad, Prov. Bs. As.) por agente en la tanda de trámites documentales.
-- 1 = el agente entra por la Ley 10592 (cupo de discapacidad) → en "Documentación incompleta"
-- se le pide el "Certificado de discapacidad (Terminos Ley 10592)". 0 = no se pide.
-- La API también agrega la columna sola al arrancar si falta (tramitesDocumentales.routes.ts).
-- NO idempotente: verificar con SHOW COLUMNS antes de re-aplicar.
ALTER TABLE tramites_tanda_interinos ADD COLUMN ley_10592 TINYINT(1) NOT NULL DEFAULT 0;
