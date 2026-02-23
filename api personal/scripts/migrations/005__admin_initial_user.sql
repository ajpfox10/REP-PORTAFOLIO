-- Migration: 005__admin_initial_user.sql
-- Description: Creates the initial admin user and assigns the superadmin role.
-- IMPORTANTE: Cambiar la contraseña del admin INMEDIATAMENTE después del primer login.
-- La contraseña por defecto es: Admin1234! (bcrypt hash incluido abajo)
-- Para regenerar el hash: node -e "const b=require('bcryptjs'); b.hash('NuevaPass', 12).then(console.log)"

-- Verificar que el rol superadmin exista (creado en 001__auth_rbac_core.sql)
-- Si no existe, crearlo
INSERT IGNORE INTO roles (id, nombre, descripcion, created_at)
VALUES (1, 'superadmin', 'Acceso total al sistema', NOW());

-- Crear usuario admin solo si no existe uno con ese email
INSERT INTO usuarios (email, nombre, password, estado, created_at, updated_at)
SELECT 
  'admin@sistema.local',
  'Administrador del Sistema',
  -- bcrypt hash de 'Admin1234!' con 12 rounds
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCaMBMPlPwKR9mniVQFCLmy',
  'activo',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM usuarios WHERE email = 'admin@sistema.local'
);

-- Asignar rol superadmin al admin si no tiene uno
INSERT INTO usuarios_roles (usuario_id, rol_id, created_at)
SELECT u.id, 1, NOW()
FROM usuarios u
WHERE u.email = 'admin@sistema.local'
  AND NOT EXISTS (
    SELECT 1 FROM usuarios_roles ur WHERE ur.usuario_id = u.id
  )
LIMIT 1;

-- Verificar que el rol superadmin tenga el permiso crud:*:* (acceso total)
-- Buscar el permiso id 145 (crud:*:*) y asignarlo si no está
INSERT INTO roles_permisos (rol_id, permiso_id, created_at)
SELECT 1, p.id, NOW()
FROM permisos p
WHERE p.clave IN ('crud:*:*', 'api:access', 'usuarios:write', 'usuarios:read', 'roles:read', 'roles:write', 'metrics:read')
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = 1 AND rp.permiso_id = p.id
  );
