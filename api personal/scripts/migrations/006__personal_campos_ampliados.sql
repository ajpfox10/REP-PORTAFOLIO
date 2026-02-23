-- ============================================================
-- Migration: 006__personal_campos_ampliados.sql
-- Descripción: Agrega columnas al tabla personal que necesita
--   el módulo CargaAgente (foto, contacto, catálogos FK).
-- Ejecutar DESPUÉS de las migraciones 000-005.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- 1. Contacto y domicilio
ALTER TABLE `personal`
  ADD COLUMN IF NOT EXISTS `email`       VARCHAR(255)  NULL AFTER `cuil`,
  ADD COLUMN IF NOT EXISTS `telefono`    VARCHAR(50)   NULL AFTER `email`,
  ADD COLUMN IF NOT EXISTS `domicilio`   VARCHAR(255)  NULL AFTER `telefono`,
  ADD COLUMN IF NOT EXISTS `localidad_id` INT          NULL AFTER `domicilio`;

-- 2. Campos laborales adicionales
ALTER TABLE `personal`
  ADD COLUMN IF NOT EXISTS `funcion_id`   INT          NULL AFTER `planta_id`,
  ADD COLUMN IF NOT EXISTS `dependencia`  VARCHAR(255) NULL AFTER `reparticion_id`,
  ADD COLUMN IF NOT EXISTS `observaciones` TEXT        NULL AFTER `dependencia`;

-- 3. Foto de carnet (ruta relativa al servidor de archivos)
-- El archivo en sí queda en tblarchivos con tipo='foto_carnet'
-- Este campo es solo referencia rápida para el carnet
ALTER TABLE `personal`
  ADD COLUMN IF NOT EXISTS `foto_path`   VARCHAR(512) NULL AFTER `observaciones`;

-- 4. Timestamp de última actualización (si no existe)
ALTER TABLE `personal`
  ADD COLUMN IF NOT EXISTS `updated_at`  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    AFTER `created_at`;

-- ============================================================
-- Índices útiles para búsquedas del módulo
-- ============================================================
-- Índice email para búsquedas futuras
CREATE INDEX IF NOT EXISTS `idx_personal_email`
  ON `personal` (`email`);

-- Índice localidad para filtros geográficos
CREATE INDEX IF NOT EXISTS `idx_personal_localidad`
  ON `personal` (`localidad_id`);

-- ============================================================
-- Vista auxiliar: personal_completo
-- Une personal con los catálogos en una sola consulta
-- Usada por los certificados y la página de gestión
-- ============================================================
CREATE OR REPLACE VIEW `personal_completo` AS
SELECT
  p.dni,
  p.apellido,
  p.nombre,
  p.cuil,
  p.fecha_nacimiento,
  p.fecha_ingreso,
  p.estado_empleo,
  p.legajo,
  p.email,
  p.telefono,
  p.domicilio,
  p.foto_path,
  p.observaciones,

  -- Sexo
  p.sexo_id,
  s.nombre                     AS sexo_nombre,

  -- Ley
  p.ley_id,
  l.nombre                     AS ley_nombre,

  -- Planta
  p.planta_id,
  pl.nombre                    AS planta_nombre,

  -- Función
  p.funcion_id,
  fn.nombre                    AS funcion_nombre,

  -- Categoría
  p.categoria_id,
  cat.nombre                   AS categoria_nombre,

  -- Repartición
  p.reparticion_id,
  rep.nombre                   AS reparticion_nombre,

  -- Dependencia directa
  p.dependencia,

  -- Localidad
  p.localidad_id,
  loc.nombre                   AS localidad_nombre,

  p.deleted_at,
  p.created_at,
  p.updated_at

FROM personal p
LEFT JOIN sexo         s   ON s.id   = p.sexo_id
LEFT JOIN ley          l   ON l.id   = p.ley_id
LEFT JOIN planta       pl  ON pl.id  = p.planta_id
LEFT JOIN funciones    fn  ON fn.id  = p.funcion_id
LEFT JOIN categoria    cat ON cat.id = p.categoria_id
LEFT JOIN reparticiones rep ON rep.id = p.reparticion_id
LEFT JOIN localidades  loc ON loc.id  = p.localidad_id
WHERE p.deleted_at IS NULL;

-- ============================================================
-- Permiso nuevo para la carga de agentes
-- ============================================================
INSERT IGNORE INTO permisos (clave, descripcion, created_at)
VALUES
  ('personal:write',  'Crear/editar agentes de personal', NOW()),
  ('personal:create', 'Dar de alta agentes nuevos',        NOW());

-- Asignar al rol superadmin (id=1) si existe
INSERT IGNORE INTO roles_permisos (rol_id, permiso_id, created_at)
SELECT 1, p.id, NOW()
FROM permisos p
WHERE p.clave IN ('personal:write', 'personal:create')
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = 1 AND rp.permiso_id = p.id
  );
