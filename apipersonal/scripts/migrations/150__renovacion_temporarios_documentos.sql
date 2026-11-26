-- 150__renovacion_temporarios_documentos.sql (26/11/2026, sale de partir la 148)
-- Lista de documentos de 'RENOVACION TEMPORARIOS 10430': arranca como copia de 'PASE A TRANSITORIA'
-- (ambas leyes); las diferencias se ajustan en la pestaña "Documentos por trámite".
-- Una sola sentencia. No copia si la lista ya existe (no pisa lo ajustado a mano).

INSERT INTO orden_documentos_expediente (proceso, ley, orden, documento, observacion, activo)
SELECT 'RENOVACION TEMPORARIOS 10430', o.ley, o.orden, o.documento, o.observacion, o.activo
  FROM orden_documentos_expediente o
 WHERE o.proceso = 'PASE A TRANSITORIA'
   AND NOT EXISTS (SELECT 1 FROM (SELECT proceso FROM orden_documentos_expediente) x
                    WHERE x.proceso = 'RENOVACION TEMPORARIOS 10430')
