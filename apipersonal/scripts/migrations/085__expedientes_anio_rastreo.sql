-- 085: año de expedientes que 083/084 dejaron vacio, encontrado rastreando las otras bases
-- (personalv3.consultas/cedula/informe/pedidos/expedientes.memo: texto EX-AAAA-<numero>).
-- Solo numeros con un unico año. Conserva updated_at.
UPDATE expedientes e
JOIN (
  SELECT 22642290 AS num, 2019 AS anio
  UNION ALL SELECT 35593499 AS num, 2019 AS anio
  UNION ALL SELECT 27120711 AS num, 2023 AS anio
  UNION ALL SELECT 9591401 AS num, 2019 AS anio
  UNION ALL SELECT 27909014 AS num, 2018 AS anio
  UNION ALL SELECT 29384069 AS num, 2019 AS anio
  UNION ALL SELECT 34818304 AS num, 2019 AS anio
  UNION ALL SELECT 35693902 AS num, 2019 AS anio
  UNION ALL SELECT 40183217 AS num, 2019 AS anio
  UNION ALL SELECT 36788793 AS num, 2019 AS anio
  UNION ALL SELECT 11379416 AS num, 2019 AS anio
  UNION ALL SELECT 877167 AS num, 2020 AS anio
  UNION ALL SELECT 1208925 AS num, 2021 AS anio
  UNION ALL SELECT 1523959 AS num, 2021 AS anio
  UNION ALL SELECT 6214309 AS num, 2020 AS anio
  UNION ALL SELECT 7587799 AS num, 2022 AS anio
  UNION ALL SELECT 3141443 AS num, 2018 AS anio
  UNION ALL SELECT 12220024 AS num, 2018 AS anio
  UNION ALL SELECT 14659303 AS num, 2018 AS anio
  UNION ALL SELECT 15453894 AS num, 2018 AS anio
  UNION ALL SELECT 1650103 AS num, 2019 AS anio
) t ON t.num = CAST(e.numero AS UNSIGNED)
SET e.anio = t.anio, e.updated_at = e.updated_at
WHERE e.anio IS NULL AND e.deleted_at IS NULL AND e.numero REGEXP '^[0-9]+$';
