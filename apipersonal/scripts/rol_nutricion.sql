-- rol_nutricion.sql
-- Crea el permiso + rol para Nutrición (página "Turnos de más de 10 horas").
-- Idempotente: se puede correr varias veces sin duplicar.
--
-- Después de correr esto:
--   1) Crear el usuario (login + contraseña) desde la pantalla de Admin.
--   2) Asignarle el rol 'nutricion' en el combo de rol.

-- 1) Permiso de acceso a la página --------------------------------------------
INSERT INTO permisos (clave, descripcion, dominio_id, created_at)
SELECT 'app:horarios-extendidos:access',
       'Acceso a la página Turnos de más de 10 horas (Excel de horarios)',
       NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'app:horarios-extendidos:access');

-- 2) Rol dedicado -------------------------------------------------------------
INSERT INTO roles (nombre, descripcion)
SELECT 'nutricion',
       'Nutrición: consulta de agentes con turnos de más de 10 horas'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'nutricion');

-- 3) Grants del rol: api:access + acceso a la página --------------------------
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave IN ('api:access', 'app:horarios-extendidos:access')
WHERE r.nombre = 'nutricion'
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp
    WHERE rp.rol_id = r.id AND rp.permiso_id = p.id AND rp.deleted_at IS NULL
  );

-- Verificación (opcional):
-- SELECT r.nombre, p.clave
-- FROM roles r
-- JOIN roles_permisos rp ON rp.rol_id = r.id AND rp.deleted_at IS NULL
-- JOIN permisos p ON p.id = rp.permiso_id
-- WHERE r.nombre = 'nutricion';
