-- Nota de designación para GDEBA (una por agente y tanda).
-- La genera Trámites → tanda → "📝 Nota GDEBA" (.docx en DOCU\<DNI>\Nota designacion GDEBA\)
-- y la lee después el robot que la carga en GDEBA (estado / gdeba_numero).
CREATE TABLE IF NOT EXISTS tramites_nota_designacion (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tanda VARCHAR(80) NOT NULL,
  dni INT NOT NULL,
  tratamiento VARCHAR(10) NOT NULL,
  apellido_nombre VARCHAR(200) NOT NULL,
  establecimiento VARCHAR(150) NOT NULL,
  ley VARCHAR(20) NOT NULL DEFAULT '10.430',
  horas VARCHAR(10) NOT NULL,
  cargo VARCHAR(200) NOT NULL,
  agrupamiento VARCHAR(60) NOT NULL,
  categoria VARCHAR(10) NOT NULL,
  texto TEXT NOT NULL,
  archivo VARCHAR(500) NULL,
  estado ENUM('GENERADA','CARGADA_GDEBA','ERROR') NOT NULL DEFAULT 'GENERADA',
  gdeba_numero VARCHAR(80) NULL,
  gdeba_error VARCHAR(500) NULL,
  generada_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generada_por INT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nota_desig_tanda_dni (tanda, dni),
  KEY ix_nota_desig_estado (estado),
  CONSTRAINT fk_nota_desig_personal FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
