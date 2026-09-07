-- ============================================================
-- seed_test_data.sql — 5 registros de prueba por tabla principal
-- Ejecutar contra AWS RDS directamente
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

SET @org_id    = (SELECT id FROM organizations LIMIT 1);
SET @branch_id = (SELECT id FROM branches WHERE organization_id = @org_id LIMIT 1);
SET @vet_role  = (SELECT id FROM roles WHERE name = 'veterinarian');
SET @recep_role= (SELECT id FROM roles WHERE name = 'receptionist');

-- ─── 1. Usuarios de prueba ────────────────────────────────────────────────────
INSERT IGNORE INTO users
  (first_name, last_name, email, password_hash, branch_id, is_active)
VALUES
  ('María',    'González',  'maria.gonzalez@test-vet.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', @branch_id, 1),
  ('Carlos',   'Rodríguez', 'carlos.rodriguez@test-vet.com','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', @branch_id, 1),
  ('Sofía',    'Martínez',  'sofia.martinez@test-vet.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', @branch_id, 1),
  ('Diego',    'López',     'diego.lopez@test-vet.com',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', @branch_id, 1),
  ('Valentina','Pérez',     'valentina.perez@test-vet.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', @branch_id, 1);

INSERT IGNORE INTO user_roles (user_id, role_id, is_active, assigned_at)
SELECT u.id, @vet_role, 1, NOW()
FROM users u
WHERE u.email IN ('maria.gonzalez@test-vet.com','carlos.rodriguez@test-vet.com','sofia.martinez@test-vet.com')
AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = @vet_role);

INSERT IGNORE INTO user_roles (user_id, role_id, is_active, assigned_at)
SELECT u.id, @recep_role, 1, NOW()
FROM users u
WHERE u.email IN ('diego.lopez@test-vet.com','valentina.perez@test-vet.com')
AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = @recep_role);

-- ─── 2. Clientes ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO clients
  (branch_id, first_name, last_name, email, phone, document_number, document_type, is_active)
VALUES
  (@branch_id, 'Ana',     'Gómez',    'ana.gomez@email.com',     '+54911111111', '28111111', 'DNI', 1),
  (@branch_id, 'Pedro',   'Sánchez',  'pedro.sanchez@email.com', '+54922222222', '30222222', 'DNI', 1),
  (@branch_id, 'Laura',   'Fernández','laura.fernandez@email.com','+54933333333','32333333', 'DNI', 1),
  (@branch_id, 'Javier',  'Torres',   'javier.torres@email.com', '+54944444444', '25444444', 'DNI', 1),
  (@branch_id, 'Camila',  'Díaz',     'camila.diaz@email.com',   '+54955555555', '35555555', 'DNI', 1);

-- ─── 3. Pacientes ────────────────────────────────────────────────────────────
SET @dog_species = (SELECT id FROM species WHERE common_name LIKE '%Perro%' OR common_name = 'Canino' LIMIT 1);
SET @cat_species = (SELECT id FROM species WHERE common_name LIKE '%Gato%'  OR common_name = 'Felino' LIMIT 1);
SET @dog_species = COALESCE(@dog_species, (SELECT id FROM species LIMIT 1));
SET @cat_species = COALESCE(@cat_species, @dog_species);

INSERT IGNORE INTO patients
  (organization_id, species_id, name, sex, birthdate, weight_kg, is_active)
VALUES
  (@org_id, @dog_species, 'Tobias', 'male',   '2020-03-15', 12.500, 1),
  (@org_id, @cat_species, 'Mía',    'female', '2021-06-20',  4.200, 1),
  (@org_id, @dog_species, 'Rocky',  'male',   '2019-11-08', 28.000, 1),
  (@org_id, @cat_species, 'Luna',   'female', '2022-01-10',  3.800, 1),
  (@org_id, @dog_species, 'Nala',   'female', '2018-07-25',  8.300, 1);

INSERT IGNORE INTO patient_owners (patient_id, client_id, ownership_type)
SELECT p.id, c.id, 'primary'
FROM patients p
JOIN clients c ON (
  (p.name = 'Tobias' AND c.email = 'ana.gomez@email.com')     OR
  (p.name = 'Mía'    AND c.email = 'pedro.sanchez@email.com') OR
  (p.name = 'Rocky'  AND c.email = 'laura.fernandez@email.com') OR
  (p.name = 'Luna'   AND c.email = 'javier.torres@email.com') OR
  (p.name = 'Nala'   AND c.email = 'camila.diaz@email.com')
)
WHERE p.organization_id = @org_id
  AND NOT EXISTS (SELECT 1 FROM patient_owners po WHERE po.patient_id = p.id AND po.client_id = c.id);

-- ─── 4. Tipos de turno ────────────────────────────────────────────────────────
INSERT IGNORE INTO appointment_types (name, default_duration_minutes, color_hex, is_active)
VALUES
  ('Consulta general', 30,  '#06D6A0', 1),
  ('Vacunación',       15,  '#FFB703', 1),
  ('Cirugía',          120, '#EF5350', 1),
  ('Control post-op',  30,  '#4BB8E0', 1),
  ('Ecografía',        45,  '#9C27B0', 1)
ON DUPLICATE KEY UPDATE default_duration_minutes = VALUES(default_duration_minutes);

-- ─── 5. Turnos ───────────────────────────────────────────────────────────────
SET @vet_user  = (SELECT id FROM users WHERE email = 'maria.gonzalez@test-vet.com' LIMIT 1);
SET @appt_type = (SELECT id FROM appointment_types WHERE name = 'Consulta general' LIMIT 1);

INSERT IGNORE INTO appointments
  (branch_id, patient_id, vet_id, appointment_type_id, scheduled_date, duration_minutes, status, notes)
SELECT
  @branch_id,
  p.id,
  @vet_user,
  @appt_type,
  DATE_ADD(NOW(), INTERVAL (ROW_NUMBER() OVER (ORDER BY p.id)) DAY),
  30,
  'scheduled',
  CONCAT('Turno de prueba para ', p.name)
FROM patients p
WHERE p.organization_id = @org_id
  AND p.name IN ('Tobias','Mía','Rocky','Luna','Nala')
LIMIT 5;

-- ─── 6. Vacunaciones ─────────────────────────────────────────────────────────
SET @vaccine_id = (SELECT id FROM vaccines LIMIT 1);

INSERT IGNORE INTO vaccinations
  (branch_id, patient_id, vaccine_id, vaccination_date, next_due_date, administered_by, notes)
SELECT
  @branch_id,
  p.id,
  @vaccine_id,
  DATE_SUB(CURDATE(), INTERVAL (ROW_NUMBER() OVER (ORDER BY p.id)) * 30 DAY),
  DATE_ADD(CURDATE(), INTERVAL (12 - ROW_NUMBER() OVER (ORDER BY p.id)) MONTH),
  @vet_user,
  'Vacunación de prueba'
FROM patients p
WHERE p.organization_id = @org_id
  AND p.name IN ('Tobias','Mía','Rocky','Luna','Nala')
  AND @vaccine_id IS NOT NULL
LIMIT 5;

-- ─── 7. Items de inventario ───────────────────────────────────────────────────
INSERT IGNORE INTO inventory_items
  (branch_id, name, item_type, unit, stock_quantity, minimum_stock, unit_cost, is_active)
VALUES
  (@branch_id, 'Amoxicilina 500mg',      'medication', 'comprimido', 200, 50,  15.0000, 1),
  (@branch_id, 'Suero fisiológico 500mL','medication', 'unidad',      80, 20, 120.0000, 1),
  (@branch_id, 'Guantes descartables M', 'supply',     'par',        500, 100,  8.0000, 1),
  (@branch_id, 'Jeringa 10mL',           'supply',     'unidad',     300, 50,  12.5000, 1),
  (@branch_id, 'Antiparasitario Frontline','medication','pipeta',     60,  15, 350.0000, 1)
ON DUPLICATE KEY UPDATE stock_quantity = stock_quantity;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Seed completado.' AS resultado;
