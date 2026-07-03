-- Agrega el mes de corte trimestral al registro de posibles jubilados

ALTER TABLE posibles_jubilados
  ADD COLUMN mes_corte enum('MARZO','JUNIO','SEPTIEMBRE','DICIEMBRE') NULL
    AFTER tipo_jubilacion,
  ADD INDEX idx_posibles_jub_mes_corte (mes_corte);
