-- 035__historial_idx_dimensiones.sql
-- Índices cubridores para los GROUP BY del tablero por dependencia /
-- agrupamiento / régimen / planta / justificado. Cada uno incluye novedad
-- (para el filtro <> 'PRESENTE'), dni (COUNT DISTINCT) y las fechas (DATEDIFF),
-- así la query resuelve todo desde el índice sin leer filas.
ALTER TABLE historial
  ADD KEY ix_historial__dep    (dependencia, dni, novedad, fecha_desde, fecha_hasta),
  ADD KEY ix_historial__agrup  (agrupamiento, dni, novedad, fecha_desde, fecha_hasta),
  ADD KEY ix_historial__regimen (regimen_estatutario, dni, novedad, fecha_desde, fecha_hasta),
  ADD KEY ix_historial__planta (planta, dni, novedad, fecha_desde, fecha_hasta),
  ADD KEY ix_historial__justif (justificado, dni, novedad, fecha_desde, fecha_hasta);
