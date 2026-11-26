-- 149__tanda_renovacion_2027_tipo.sql (26/11/2026, sale de partir la 148)
-- Tipo de trámite de la tanda "RENOVACIÓN TEMPORARIOS 10430 2027" = 'RENOVACION TEMPORARIOS 10430'.
-- Una sola sentencia (el runner no admite varias por archivo). No pisa si ya existe.

INSERT INTO tramites_tanda_tipo (tanda, proceso, usuario)
VALUES ('RENOVACIÓN TEMPORARIOS 10430 2027', 'RENOVACION TEMPORARIOS 10430', 'mig 149')
ON DUPLICATE KEY UPDATE tanda = tanda
