-- 060__agentes_especialidades.sql
-- Especialidad del agente con historial: reemplaza a personal.especialidad_id (mig 059),
-- que todavia no tenia datos. Misma forma que agentes_servicios / agentes_sectores:
-- un periodo por fila, la vigente es la que tiene fecha_hasta NULL.
--
-- Cambiar de especialidad = cerrar la vigente (fecha_hasta = cierre) y abrir otra
-- (fecha_desde = alta, por defecto el dia siguiente al cierre). Lo hacen
-- POST /personal/:dni/especialidades/cambio, el alta del agente y la edicion del form.
--
-- `abierta` es 1 solo para el periodo vigente no anulado (NULL en el resto): el UNIQUE
-- (dni, abierta) impide dos especialidades abiertas a la vez para el mismo agente.
--
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.

CREATE TABLE agentes_especialidades (
  id              INT NOT NULL AUTO_INCREMENT,
  dni             INT NOT NULL,
  especialidad_id INT NOT NULL,
  fecha_desde     DATE NOT NULL,
  fecha_hasta     DATE NULL,
  observaciones   VARCHAR(255) NULL,
  abierta         TINYINT GENERATED ALWAYS AS
                    (IF(fecha_hasta IS NULL AND deleted_at IS NULL, 1, NULL)) STORED,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  created_by      INT NULL,
  updated_by      INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_agesp_una_abierta (dni, abierta),
  KEY ix_agesp_dni (dni, fecha_desde),
  KEY ix_agesp_especialidad (especialidad_id),
  CONSTRAINT fk_agesp_personal     FOREIGN KEY (dni)             REFERENCES personal (dni),
  CONSTRAINT fk_agesp_especialidad FOREIGN KEY (especialidad_id) REFERENCES especialidaddesmedicas (id)
);

-- Fuente unica: la especialidad vigente se deriva de agentes_especialidades.
ALTER TABLE personal
  DROP FOREIGN KEY fk_personal_especialidad,
  DROP INDEX ix_personal_especialidad,
  DROP COLUMN especialidad_id;
