-- 079__resoluciones_archivo_id.sql
-- Vínculo resolución → archivo escaneado (16/10/2026).
-- Antes no había relación: el visor de /app/resoluciones buscaba el archivo por número.
-- Se llena al guardar una resolución con escaneo (scanner document-ready, ref 'respage|…')
-- y desde el visor cuando se elige el archivo a mano. Las existentes se completaron
-- por backfill (número exacto en tblarchivos del agente o tipo-número-año contra
-- RESOLUCIONES Y VARIOS, filas dni=1).
-- NO idempotente (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS).

ALTER TABLE `resoluciones`
  ADD COLUMN `archivo_id` INT NULL AFTER `fecha`,
  ADD KEY `idx_resoluciones_archivo_id` (`archivo_id`),
  ADD CONSTRAINT `fk_resoluciones_archivo` FOREIGN KEY (`archivo_id`)
    REFERENCES `tblarchivos` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
