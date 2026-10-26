-- 088__permiso_normativa.sql
-- Página /app/normativa (decretos de plus de guardia y planta Ley 10471, 20/10/2026).
-- La ven admin y admin_catalogos (ya tienen crud:*:*) y el rol reader (id 2) por este permiso.
-- Idempotente.

INSERT INTO permisos (clave, descripcion, created_at)
SELECT 'app:normativa:access', 'Ver la página Normativa (plus de guardia y planta)', NOW()
 WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'app:normativa:access');  -- sync-guard:ignore

UPDATE permisos SET deleted_at = NULL WHERE clave = 'app:normativa:access';  -- sync-guard:ignore

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permisos p ON p.clave = 'app:normativa:access'  -- sync-guard:ignore
 WHERE r.nombre = 'reader'
   AND NOT EXISTS (
     SELECT 1 FROM roles_permisos x
      WHERE x.rol_id = r.id AND x.permiso_id = p.id AND x.deleted_at IS NULL
   );
