-- 039__personal_provincia_id.sql
-- Agrega provincia_id a personal para guardar la provincia del domicilio.
-- Tipo VARCHAR(50) para coincidir con localidades.provincia_id (valores tipo "6").
-- La provincia se deduce de la localidad; esta columna la persiste para consultas/filtros sin JOIN.
ALTER TABLE personal
  ADD COLUMN provincia_id VARCHAR(50) NULL AFTER localidad_id;

-- Backfill: completar provincia_id de los registros que ya tienen localidad cargada.
UPDATE personal p
  JOIN localidades l ON l.id = p.localidad_id
  SET p.provincia_id = l.provincia_id
  WHERE p.localidad_id IS NOT NULL
    AND (p.provincia_id IS NULL OR p.provincia_id = '');
