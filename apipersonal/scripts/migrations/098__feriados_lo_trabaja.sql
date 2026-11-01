-- 098: quién trabaja cada feriado (pedido 27/10/2026).
--   · feriados.lo_trabaja: 'franqueros' = lo cubren los franqueros (toca sábado/domingo, sin L-V completo) con su
--     horario de finde y el resto no va · 'semana' = se trabaja como un día hábil común (algunos no laborables).
--   Presentismo por turno arma los teóricos del día según esta columna.
--   Los existentes quedan en 'franqueros' salvo los no laborables.
-- Idempotente.

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feriados' AND COLUMN_NAME = 'lo_trabaja');
SET @sql := IF(@existe = 0,
  "ALTER TABLE feriados ADD COLUMN lo_trabaja ENUM('franqueros','semana') NOT NULL DEFAULT 'franqueros' AFTER tipo",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE feriados SET lo_trabaja = 'semana' WHERE tipo = 'no_laborable' AND @existe = 0;
