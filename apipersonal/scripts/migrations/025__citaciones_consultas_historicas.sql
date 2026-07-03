-- Crea una consulta historica por cada citacion cerrada.
-- Es idempotente: la explicacion identifica cada consulta por citacion.

INSERT INTO consultas (
  dni,
  motivo_consulta,
  explicacion,
  atendido_por,
  hora_atencion,
  impreso,
  created_at,
  updated_at
)
SELECT
  c.dni,
  'Citación atendida',
  CONCAT_WS(
    ' | ',
    CONCAT('Citación #', c.id),
    IF(NULLIF(TRIM(c.motivo), '') IS NULL, NULL, CONCAT('Motivo: ', TRIM(c.motivo))),
    IF(NULLIF(TRIM(c.citado_por), '') IS NULL, NULL, CONCAT('Citado por: ', TRIM(c.citado_por)))
  ),
  'Migración',
  c.cierre_citacion,
  'no',
  c.cierre_citacion,
  c.cierre_citacion
FROM citaciones c
WHERE c.cierre_citacion IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM consultas q
    WHERE q.dni = c.dni
      AND q.motivo_consulta = 'Citación atendida'
      AND q.explicacion LIKE CONCAT('Citación #', c.id, '%')
  );
