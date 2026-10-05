-- 061__embarazadas_guarderia_avisada.sql
-- Aviso de guarderia a la embarazada nombrada que paso 90 dias de la FPP sin registro
-- en `guarderia`. Es un aviso distinto de alerta_45_* (ese es 45 dias ANTES de la FPP),
-- por eso va en columnas propias. Lo marca el boton "Avisada" del banner del inicio y
-- de Guarderia y Salario; con guarderia_avisada=1 la agente deja de aparecer.
--
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.
-- Tras aplicarlo borrar .cache/schema.json (el CRUD dinamico cachea las columnas).

ALTER TABLE embarazadas
  ADD COLUMN guarderia_avisada TINYINT(1) NOT NULL DEFAULT 0 AFTER alerta_45_usuario_nombre,
  ADD COLUMN guarderia_avisada_fecha DATETIME NULL AFTER guarderia_avisada,
  ADD COLUMN guarderia_avisada_usuario_id INT NULL AFTER guarderia_avisada_fecha,
  ADD COLUMN guarderia_avisada_usuario_email VARCHAR(255) NULL AFTER guarderia_avisada_usuario_id,
  ADD COLUMN guarderia_avisada_usuario_nombre VARCHAR(255) NULL AFTER guarderia_avisada_usuario_email;
