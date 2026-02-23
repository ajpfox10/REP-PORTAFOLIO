-- ============================================================
-- Migration: 007__fix_tblarchivos_ruta.sql
-- Descripción: Arregla la columna `ruta` de tblarchivos.
--   Antes guardaba solo el año (ej: "2025").
--   Ahora debe guardar el path relativo completo (ej: "2025/filename.pdf").
--
-- NOTA: Para registros viejos donde ruta es solo el año y no tenemos
-- el nombre del archivo en disco (fue renombrado al subir), no podemos
-- reconstruir el path automáticamente.
-- Los registros NUEVOS ya guardan ruta correctamente con este fix.
--
-- Para registros viejos, el endpoint intentará: ruta/nombre_archivo_original
-- como fallback (puede funcionar si el archivo aún tiene el nombre original).
-- ============================================================

-- Agregar índice en ruta para búsquedas rápidas por año
CREATE INDEX IF NOT EXISTS `idx_tblarchivos_ruta` ON `tblarchivos` (`ruta`);

-- Agregar columna anio si no existe (para búsquedas por año sin parsear ruta)
ALTER TABLE `tblarchivos`
  ADD COLUMN IF NOT EXISTS `anio` INT NULL AFTER `fecha`;

-- Poblar anio en registros existentes donde ruta es solo el año (4 dígitos)
UPDATE `tblarchivos`
SET `anio` = CAST(`ruta` AS UNSIGNED)
WHERE `ruta` REGEXP '^[0-9]{4}$'
  AND `anio` IS NULL;

-- Poblar anio en registros con nuevo formato ruta "2025/archivo.pdf"
UPDATE `tblarchivos`
SET `anio` = CAST(SUBSTRING_INDEX(`ruta`, '/', 1) AS UNSIGNED)
WHERE `ruta` LIKE '%/%'
  AND `anio` IS NULL;

-- ============================================================
-- Índice útil para búsquedas por DNI + año
-- ============================================================
CREATE INDEX IF NOT EXISTS `idx_tblarchivos_dni_anio`
  ON `tblarchivos` (`dni`, `anio`);
