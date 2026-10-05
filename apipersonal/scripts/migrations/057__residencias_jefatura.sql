-- 057__residencias_jefatura.sql
-- Jefatura de residentes: el residente que termina puede pasar a jefe de
-- residentes de su especialidad (cierra el tramo con CAMBIO DE OCUPACION y abre
-- uno nuevo con la ocupacion "JEFE DE RESIDENTE(S) ...").
--
-- El router /residencias aplica esto solo en runtime (ensureJefatura) si falta:
-- NO es idempotente como SQL plano. Verificar en information_schema antes de correrlo.

ALTER TABLE residencias
  ADD COLUMN ocupacion_jefe_id INT NULL AFTER anios;

ALTER TABLE residentes_residencia
  ADD COLUMN jefatura_desde DATE NULL AFTER fecha_inicio,
  ADD COLUMN jefatura_ocupacion_id INT NULL AFTER jefatura_desde;

ALTER TABLE residencias_bajas
  MODIFY estado ENUM('PENDIENTE','BAJA','NO_CORRESPONDE','JEFATURA') NOT NULL DEFAULT 'PENDIENTE';

-- Residencias que faltaban en el catalogo (existian como ocupaciones RESIDENTE X n)
INSERT IGNORE INTO residencias (nombre, anios) VALUES
  ('NEONATOLOGIA', 4), ('OBSTETRICIA', 4), ('BIOQUIMICA', 3),
  ('ENFERMERIA', 3), ('ENFERMERIA ESPECIALIZADA', 3);

-- Vinculo residencia -> cargo de jefe (ocupaciones)
UPDATE residencias SET ocupacion_jefe_id = CASE nombre
  WHEN 'TERAPIA INTENSIVA'        THEN 1197
  WHEN 'CIRUGIA GENERAL'          THEN 1195
  WHEN 'TRAUMATOLOGIA'            THEN 1188
  WHEN 'CLINICA MEDICA'           THEN 1196
  WHEN 'ANESTESIOLOGIA'           THEN 1204
  WHEN 'TRABAJO SOCIAL'           THEN 1199
  WHEN 'FONOAUDIOLOGIA'           THEN 1212
  WHEN 'NEONATOLOGIA'             THEN 1170
  WHEN 'OBSTETRICIA'              THEN 1175
  WHEN 'BIOQUIMICA'               THEN 1198
  WHEN 'ENFERMERIA'               THEN 1208
  WHEN 'ENFERMERIA ESPECIALIZADA' THEN 1216
  ELSE ocupacion_jefe_id END
WHERE ocupacion_jefe_id IS NULL;
