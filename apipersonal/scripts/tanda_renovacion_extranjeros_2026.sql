-- Tanda de renovación de becarios de radicación (Programa Beca de Radicación para Profesionales
-- Extranjeros, ley_id 12), vigentes = ACTIVO / TRAMITE / COMISION. 17/11/2026.
-- Correr en PRODUCCIÓN recién DESPUÉS del deploy de pase_planta.py (excluye tandas "RENOVACI%";
-- el pase_planta viejo recorre todas las tandas y armaría carpetas de estos becarios en Pase a planta).
INSERT IGNORE INTO tramites_tanda_interinos (tanda, dni, origen, anio)
SELECT DISTINCT 'RENOVACIÓN EXTRANJEROS 2026', a.dni, 'manual', NULL
  FROM agentes a JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
 WHERE a.ley_id = 12 AND a.deleted_at IS NULL AND a.estado_empleo IN ('ACTIVO','TRAMITE','COMISION');
