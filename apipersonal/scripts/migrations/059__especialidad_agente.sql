-- 059__especialidad_agente.sql
-- Especialidad del agente (una por persona): medicos, bioquimicos, odontologos,
-- psicologos, etc. Cada profesion tiene su propio juego de especialidades, asi que
-- el catalogo (especialidaddesmedicas, vacio hasta ahora) suma la columna
-- `profesion` y la unicidad pasa a ser profesion+especialidad (HEMATOLOGIA puede
-- existir para MEDICO y para BIOQUIMICO).
--
-- La especialidad vive en `personal` (junto a la matricula `mp`), no en `agentes`:
-- es de la persona y no se pierde al cerrar/abrir tramos (cambio de ocupacion, de DNI).
--
-- El catalogo se carga desde Admin -> Catalogos -> Especialidades. No se importan datos.
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.

ALTER TABLE especialidaddesmedicas
  ADD COLUMN profesion VARCHAR(60) NULL AFTER especialidad,
  DROP INDEX ux_especialidad,
  ADD UNIQUE KEY ux_especialidad_profesion (profesion, especialidad);

ALTER TABLE personal
  ADD COLUMN especialidad_id INT NULL AFTER mp,
  ADD KEY ix_personal_especialidad (especialidad_id),
  ADD CONSTRAINT fk_personal_especialidad
    FOREIGN KEY (especialidad_id) REFERENCES especialidaddesmedicas (id);
