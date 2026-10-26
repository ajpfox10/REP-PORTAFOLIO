-- 083: año del expediente como columna propia (expedientes.anio).
-- La importacion del 10/02/2026 trajo solo el numero pelado (sin año ni fecha);
-- el año esta en personalv3.expedientes.`año`. Los cargados a mano lo traen
-- dentro del numero (EX-2026-..., EX-...-GDEBA-2026, EX-2910-7037-2026-0) o en la fecha.
-- Los UPDATE conservan updated_at (la columna tiene ON UPDATE CURRENT_TIMESTAMP).
ALTER TABLE expedientes
  ADD COLUMN anio SMALLINT NULL AFTER numero;

-- 1) Importados: año de personalv3 (mismo agente + mismo numero), solo si es unico.
UPDATE expedientes e
JOIN (
  SELECT e2.id, MIN(v.`año`) AS anio
    FROM expedientes e2
    JOIN personalv3.expedientes v
      ON v.agente = e2.dni
     AND v.expedientenumero = CAST(e2.numero AS UNSIGNED)
   WHERE e2.numero REGEXP '^[0-9]+$'
     AND v.`año` REGEXP '^(19|20)[0-9]{2}$'
   GROUP BY e2.id
  HAVING COUNT(DISTINCT v.`año`) = 1
) t ON t.id = e.id
SET e.anio = CAST(t.anio AS UNSIGNED), e.updated_at = e.updated_at;

-- 2) Año escrito dentro del numero (4 digitos 19xx/20xx sueltos).
UPDATE expedientes
   SET anio = CAST(REGEXP_SUBSTR(numero, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])') AS UNSIGNED), updated_at = updated_at
 WHERE anio IS NULL
   AND numero REGEXP '[A-Za-z/-]'
   AND REGEXP_SUBSTR(numero, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])') IS NOT NULL;

-- 3) Lo que quede: año de la fecha.
UPDATE expedientes
   SET anio = YEAR(fecha), updated_at = updated_at
 WHERE anio IS NULL AND fecha IS NOT NULL;
