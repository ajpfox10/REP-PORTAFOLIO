-- 011__pedidos_baja_por_nombre.sql
-- Agrega campo para registrar quién dio de baja un pedido

ALTER TABLE `pedidos`
  ADD COLUMN IF NOT EXISTS `baja_por_nombre` VARCHAR(190) NULL DEFAULT NULL COMMENT 'Usuario que dio de baja el pedido',
  ADD COLUMN IF NOT EXISTS `observacion`     VARCHAR(500) NULL DEFAULT NULL COMMENT 'Observación del operador';
