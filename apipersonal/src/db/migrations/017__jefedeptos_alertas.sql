-- ============================================================
-- 017: jefedeptos — campos de seguimiento de alerta de vencimiento
-- ============================================================

ALTER TABLE jefedeptos
  ADD COLUMN alerta_45_avisada       TINYINT(1)   NOT NULL DEFAULT 0 AFTER fecha_hasta,
  ADD COLUMN alerta_45_fecha         DATETIME     NULL DEFAULT NULL  AFTER alerta_45_avisada,
  ADD COLUMN alerta_45_usuario_id    INT          NULL DEFAULT NULL  AFTER alerta_45_fecha,
  ADD COLUMN alerta_45_usuario_email VARCHAR(255) NULL DEFAULT NULL  AFTER alerta_45_usuario_id,
  ADD COLUMN alerta_45_usuario_nombre VARCHAR(255) NULL DEFAULT NULL AFTER alerta_45_usuario_email;
