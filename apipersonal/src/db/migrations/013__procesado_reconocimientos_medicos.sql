-- Agrega columna procesado a reconocimientos_medicos
-- Solo visible y editable por roles admin y user (no salud_laboral)
ALTER TABLE reconocimientos_medicos
  ADD COLUMN procesado TINYINT(1) NOT NULL DEFAULT 0 AFTER observaciones;
