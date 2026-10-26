-- 084: completa expedientes.anio que 083 dejo vacio.
-- Los UPDATE conservan updated_at (la columna tiene ON UPDATE CURRENT_TIMESTAMP).

-- 1) Mismo numero cargado a otro agente con año (expediente compartido), si es unico.
UPDATE expedientes e
JOIN (
  SELECT numero, MIN(anio) AS anio
    FROM expedientes
   WHERE deleted_at IS NULL AND anio IS NOT NULL
   GROUP BY numero
  HAVING COUNT(DISTINCT anio) = 1
) o ON o.numero = e.numero
SET e.anio = o.anio, e.updated_at = e.updated_at
WHERE e.anio IS NULL AND e.deleted_at IS NULL;

-- 2) Mismo numero en personalv3 con año, de cualquier agente, si es unico.
UPDATE expedientes e
JOIN (
  SELECT expedientenumero, MIN(`año`) AS anio
    FROM personalv3.expedientes
   WHERE `año` REGEXP '^(19|20)[0-9]{2}$'
   GROUP BY expedientenumero
  HAVING COUNT(DISTINCT `año`) = 1
) v ON v.expedientenumero = CAST(e.numero AS UNSIGNED)
SET e.anio = CAST(v.anio AS UNSIGNED), e.updated_at = e.updated_at
WHERE e.anio IS NULL AND e.deleted_at IS NULL AND e.numero REGEXP '^[0-9]+$';

-- 3) Año escrito en la caratula ("Escolaridad 2018", "CONCURSO DE FUNCIONES 2018").
UPDATE expedientes
   SET anio = CAST(REGEXP_SUBSTR(caratula, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])') AS UNSIGNED), updated_at = updated_at
 WHERE anio IS NULL AND deleted_at IS NULL
   AND REGEXP_SUBSTR(caratula, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])') IS NOT NULL;
