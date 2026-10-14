-- Tramos reconocidos como insalubres por acto administrativo (antes de Jun/2015).
-- JSON: [{ "fecha_desde": "YYYY-MM-DD", "fecha_hasta": "YYYY-MM-DD", "acto": "Res. ..." }]
-- NULL / [] = sin reconocimientos (el tramo antes de 2015 sigue el flag general).
-- NO idempotente (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS). Aplicada a mano el 13/10/2026
-- en personalv5 (base compartida dev/prod) y registrada en schema_migrations.
ALTER TABLE jubilacion_calculos
  ADD COLUMN reconocimientos_insalubre JSON NULL AFTER diferencial_2pct_pagado;
