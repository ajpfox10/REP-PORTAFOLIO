-- 078__alertas_agente_desactivado_por.sql
-- Auditoría de quién desactiva una alerta por agente (16/10/2026).
-- Las alertas de jubilación bloquean la app hasta que alguien las desactive;
-- se guarda el usuario y el momento.
-- NO idempotente (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS): el router
-- alertasAgente.routes.ts las agrega solo si faltan al primer request.

ALTER TABLE `alertas_agente`
  ADD COLUMN `desactivado_por` INT      NULL AFTER `deleted_at`,
  ADD COLUMN `desactivado_at`  DATETIME NULL AFTER `desactivado_por`;
