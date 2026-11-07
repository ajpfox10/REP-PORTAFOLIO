-- 107: Novedades que el jefe carga en su portal para becados y que SIAPE no tiene (04/11/2026).
-- Circuito: portal del jefe -> SIAPE como FRANCO COMPENSATORIO (robot siape_carga_jefe)
--           -> Intranet MS con el codigo REAL (robot intranet_carga_jefe_v2_<dep>).
-- Mismas columnas que examen/prexamen (CRUD generico del portal) + fecha_hasta.
-- tipo = texto exacto de la opcion del combo de la Intranet, p.ej. '06 - POR MATERNIDAD'.
CREATE TABLE IF NOT EXISTS novedad_jefe (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni           INT NOT NULL,
  fecha         DATE NOT NULL COMMENT 'desde',
  fecha_hasta   DATE NULL COMMENT 'hasta (NULL = un dia)',
  tipo          VARCHAR(190) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'opcion del combo de la Intranet: COD - TEXTO',
  resultado     VARCHAR(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  observaciones TEXT COLLATE utf8mb4_unicode_ci,
  jefe_nombre   VARCHAR(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  sector_id     INT UNSIGNED DEFAULT NULL,
  created_by    BIGINT UNSIGNED DEFAULT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME DEFAULT NULL,
  deleted_by    BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (id),
  KEY ix_novedad_jefe_dni (dni),
  KEY ix_novedad_jefe_sector (sector_id),
  KEY ix_novedad_jefe_fecha (fecha),
  KEY ix_novedad_jefe_deleted (deleted_at),
  CONSTRAINT fk_novedad_jefe_personal_dni FOREIGN KEY (dni) REFERENCES personal (dni) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permisos CRUD: los mismos roles que ya tienen permiso_salida
INSERT INTO permisos (clave, descripcion, dominio_id)
SELECT REPLACE(p.clave, 'permiso_salida', 'novedad_jefe'), 'Novedades del jefe (becados) -> Intranet', p.dominio_id
  FROM permisos p
 WHERE p.clave LIKE 'crud:permiso_salida:%' AND p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM permisos x WHERE x.clave = REPLACE(p.clave, 'permiso_salida', 'novedad_jefe'));

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT rp.rol_id, pn.id
  FROM roles_permisos rp
  JOIN permisos po ON po.id = rp.permiso_id AND po.clave LIKE 'crud:permiso_salida:%'
  JOIN permisos pn ON pn.clave = REPLACE(po.clave, 'permiso_salida', 'novedad_jefe')
 WHERE NOT EXISTS (SELECT 1 FROM roles_permisos y WHERE y.rol_id = rp.rol_id AND y.permiso_id = pn.id);
