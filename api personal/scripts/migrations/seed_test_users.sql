-- Seed script for test/development environment
-- Creates admin user and test data

-- Get admin role ID
SET @admin_role_id = (SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1);

-- Create admin user if not exists
-- Password: Admin123! (hashed with bcrypt rounds=10)
INSERT IGNORE INTO usuarios (email, nombre, password_hash, rol_id, active, created_at, updated_at)
VALUES (
  'admin@local.com',
  'Admin User',
  '$2a$10$5Yd8qKKEz8YGLhN8WqJ3a.F.P5PQhh0w8oLy2aNq7QZ8xOEL2xQPi',
  @admin_role_id,
  1,
  NOW(),
  NOW()
);

-- Create another test user for documents/eventos tests
INSERT IGNORE INTO usuarios (email, nombre, password_hash, rol_id, active, created_at, updated_at)
VALUES (
  'test@example.com',
  'Test User',
  '$2a$10$5Yd8qKKEz8YGLhN8WqJ3a.F.P5PQhh0w8oLy2aNq7QZ8xOEL2xQPi',
  @admin_role_id,
  1,
  NOW(),
  NOW()
);

SELECT 'Admin user created successfully!' as message;
SELECT 'Email: admin@local.com' as credentials;
SELECT 'Password: Admin123!' as password_info;
