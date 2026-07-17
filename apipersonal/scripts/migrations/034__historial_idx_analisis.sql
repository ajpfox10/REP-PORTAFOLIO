-- 034__historial_idx_analisis.sql
-- Índice cubridor para el tablero de análisis (/asistencia/historial-analisis):
-- los GROUP BY novedad con COUNT(DISTINCT dni) + DATEDIFF resuelven todo desde
-- el índice sin tocar filas (de ~20s a subsegundo con ~1M registros).
ALTER TABLE historial
  ADD KEY ix_historial__analisis (novedad, dni, fecha_desde, fecha_hasta);
