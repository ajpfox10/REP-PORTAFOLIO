-- Nota de designación GDEBA: texto editable (plantilla por tanda + retoque por agente)
-- y seguimiento del estado (Generada → Enviada a firmar → Firmada con número IF / Error).
-- CARGADA_GDEBA (lo que marcaba el robot) pasa a ENVIADA_FIRMA.

ALTER TABLE tramites_nota_designacion
  MODIFY estado ENUM('GENERADA','CARGADA_GDEBA','ENVIADA_FIRMA','FIRMADA','ERROR') NOT NULL DEFAULT 'GENERADA';
UPDATE tramites_nota_designacion SET estado = 'ENVIADA_FIRMA' WHERE estado = 'CARGADA_GDEBA';
ALTER TABLE tramites_nota_designacion
  MODIFY estado ENUM('GENERADA','ENVIADA_FIRMA','FIRMADA','ERROR') NOT NULL DEFAULT 'GENERADA';

ALTER TABLE tramites_nota_designacion
  ADD COLUMN texto_editado TINYINT(1) NOT NULL DEFAULT 0 AFTER texto,
  ADD COLUMN enviada_at DATETIME NULL AFTER gdeba_error,
  ADD COLUMN firmada_at DATETIME NULL AFTER enviada_at,
  ADD COLUMN estado_at DATETIME NULL AFTER firmada_at,
  ADD COLUMN estado_por INT NULL AFTER estado_at;

-- Texto modelo de la nota por tanda, con marcadores {APELLIDO_NOMBRE}, {DNI}, {CARGO}, ...
CREATE TABLE IF NOT EXISTS tramites_nota_designacion_plantilla (
  tanda VARCHAR(80) NOT NULL PRIMARY KEY,
  plantilla TEXT NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
