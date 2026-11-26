-- 148__tanda_renovacion_temporarios_2027.sql (25/11/2026, pedido del usuario; partida en 148/149/150 el 26/11)
-- Tanda "RENOVACIÓN TEMPORARIOS 10430 2027": los temporarios de la tanda "TEMPORARIOS 10430 2026" que NO
-- están en "TANDA 1". El tipo de trámite (149) y su lista de documentos (150) van en migraciones aparte:
-- el runner manda cada archivo como UNA sola consulta (sin multipleStatements) → una sentencia por archivo.
-- La tabla tramites_tanda_tipo la crea la 147. Idempotente: no duplica agentes.

INSERT IGNORE INTO tramites_tanda_interinos (tanda, dni, estado, origen, anio)
SELECT 'RENOVACIÓN TEMPORARIOS 10430 2027', t.dni, 'pendiente', 'manual', t.anio
  FROM tramites_tanda_interinos t
 WHERE t.tanda = 'TEMPORARIOS 10430 2026'
   AND t.dni NOT IN (SELECT t1.dni FROM tramites_tanda_interinos t1 WHERE t1.tanda = 'TANDA 1')
