-- Inputs del cálculo que faltaba persistir: sin ellos un cálculo guardado no se
-- puede reconstruir en el formulario (precarga al seleccionar el agente).
ALTER TABLE jubilacion_calculos
  ADD COLUMN beca_aporto             tinyint(1) NOT NULL DEFAULT 0 AFTER situacion_revista,
  ADD COLUMN ips_aporto              tinyint(1) NOT NULL DEFAULT 1 AFTER beca_aporto,
  ADD COLUMN diferencial_2pct_pagado tinyint(1) NOT NULL DEFAULT 0 AFTER es_insalubre_ips,
  ADD COLUMN fecha_calculo           date       NULL              AFTER diferencial_2pct_pagado,
  ADD COLUMN resoluciones_manuales   json       NULL              AFTER servicios_externos;

-- El ENUM no contemplaba CONCURRENTE, que el formulario y el schema sí aceptan.
ALTER TABLE jubilacion_calculos
  MODIFY COLUMN situacion_revista
    enum('NORMAL','BECADO','RESIDENTE','CONCURRENTE','ARTICULO_48') NOT NULL DEFAULT 'NORMAL';
