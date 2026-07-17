-- 033__historial_unique.sql
-- Cada novedad del historial es única por agente + tipo + rango de fechas:
-- la base rechaza duplicados aunque se re-corra la carga.
ALTER TABLE historial
  ADD UNIQUE KEY uq_historial__novedad (dni, novedad, fecha_desde, fecha_hasta);
