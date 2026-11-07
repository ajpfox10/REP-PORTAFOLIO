-- 111: Subir documentos (07/11/2026). POST /documents/upload y /documents/:id/versions ahora exigen
-- admin (crud:*:*) o tblarchivos:write (middlewares/documentsAccess.ts). Antes cualquier logueado subía.
-- Los que suben son admin y reader: se le da tblarchivos:write al rol reader. Idempotente.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permisos p ON p.clave = 'tblarchivos:write' -- sync-guard:ignore
 WHERE r.nombre = 'reader'
   AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
