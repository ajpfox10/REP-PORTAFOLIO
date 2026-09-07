-- Pestaña "Catálogos" del Admin solo para Alex Arce (25) y Ornella Acosta (26).
--
-- Los permisos son estrictamente por rol (auth/permissionsRepo.ts), así que los
-- dos salen del rol compartido `admin` (id 1) y pasan a un clon con un permiso
-- extra. El resto de los admin (incluidas las cuentas admin@local) se quedan en
-- `admin` y pierden la pestaña.
--
-- Idempotente: se puede correr más de una vez.
-- Correr en la MISMA base que usa prod. Verificar con las consultas del final.

START TRANSACTION;

-- 1) Permiso nuevo -------------------------------------------------------------
INSERT INTO permisos (clave, descripcion, created_at)
SELECT 'admin:catalogos', 'Ver y cargar en la pestaña Catálogos del Admin', NOW()
 WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'admin:catalogos');

UPDATE permisos SET deleted_at = NULL WHERE clave = 'admin:catalogos';

-- 2) Rol clon de `admin` -------------------------------------------------------
INSERT INTO roles (nombre, descripcion)
SELECT 'admin_catalogos', 'Admin + pestaña Catálogos (Arce / Acosta)'
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'admin_catalogos');

UPDATE roles SET deleted_at = NULL WHERE nombre = 'admin_catalogos';

-- 3) Copiar los permisos de `admin` al rol nuevo -------------------------------
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT nuevo.id, rp.permiso_id
  FROM roles nuevo
  JOIN roles_permisos rp ON rp.rol_id = 1 AND rp.deleted_at IS NULL
 WHERE nuevo.nombre = 'admin_catalogos'
   AND NOT EXISTS (
     SELECT 1 FROM roles_permisos x
      WHERE x.rol_id = nuevo.id AND x.permiso_id = rp.permiso_id AND x.deleted_at IS NULL
   );

-- 4) …más el permiso de Catálogos ---------------------------------------------
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT nuevo.id, p.id
  FROM roles nuevo
  JOIN permisos p ON p.clave = 'admin:catalogos'
 WHERE nuevo.nombre = 'admin_catalogos'
   AND NOT EXISTS (
     SELECT 1 FROM roles_permisos x
      WHERE x.rol_id = nuevo.id AND x.permiso_id = p.id AND x.deleted_at IS NULL
   );

-- 5) Mover a Arce (25) y Acosta (26) ------------------------------------------
-- El JWT lleva un solo rol: el más nuevo de usuarios_roles. Cerramos el viejo
-- para no dejar dos filas vivas por usuario.
UPDATE usuarios_roles
   SET deleted_at = NOW()
 WHERE usuario_id IN (25, 26) AND rol_id = 1 AND deleted_at IS NULL;

INSERT INTO usuarios_roles (usuario_id, rol_id, created_at)
SELECT u.id, nuevo.id, NOW()
  FROM usuarios u
  JOIN roles nuevo ON nuevo.nombre = 'admin_catalogos'
 WHERE u.id IN (25, 26)
   AND NOT EXISTS (
     SELECT 1 FROM usuarios_roles x
      WHERE x.usuario_id = u.id AND x.rol_id = nuevo.id AND x.deleted_at IS NULL
   );

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────
-- Deben quedar solo Arce y Acosta con el permiso:
--   SELECT u.id, u.email, r.nombre
--     FROM usuarios u
--     JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.deleted_at IS NULL
--     JOIN roles r ON r.id = ur.rol_id
--     JOIN roles_permisos rp ON rp.rol_id = r.id AND rp.deleted_at IS NULL
--     JOIN permisos p ON p.id = rp.permiso_id AND p.clave = 'admin:catalogos';
--
-- Y el clon debe tener 175 permisos (174 de admin + el nuevo):
--   SELECT COUNT(*) FROM roles_permisos rp
--     JOIN roles r ON r.id = rp.rol_id
--    WHERE r.nombre = 'admin_catalogos' AND rp.deleted_at IS NULL;
