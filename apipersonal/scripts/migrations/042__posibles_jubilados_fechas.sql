-- 042__posibles_jubilados_fechas.sql
-- Fechas del tramite jubilatorio en el registro de posibles jubilados:
--   fecha_presentacion_papeles: cuando debe presentar / presento la documentacion
--   fecha_jubilacion:           fecha prevista o efectiva del cese jubilatorio

ALTER TABLE posibles_jubilados
  ADD COLUMN fecha_presentacion_papeles date NULL AFTER mes_corte,
  ADD COLUMN fecha_jubilacion           date NULL AFTER fecha_presentacion_papeles,
  ADD INDEX idx_posibles_jub_f_papeles     (fecha_presentacion_papeles),
  ADD INDEX idx_posibles_jub_f_jubilacion  (fecha_jubilacion);
