-- 053__residencias_duracion.sql
-- Duracion de residencias y corte anual.
--
-- `residencias` es el catalogo que pidio el usuario: una fila por residencia con
-- la cantidad de anios que dura. `residentes_residencia` dice que residencia hace
-- cada agente (el catalogo de ocupaciones no sirve como fuente: la mayoria de los
-- residentes figura como MEDICO/MEDICA, y ademas se pidio expresamente no tocarlo).
--
-- El anio de residencia NO se guarda: se calcula por antiguedad contra el corte
-- anual (31/08 por defecto, configurable con RESIDENCIAS_CORTE_MMDD en el .env).
-- Cuando los anios cumplidos alcanzan la duracion, queda una fila PENDIENTE en
-- `residencias_bajas` y el banner del panel insiste hasta que el agente esta
-- efectivamente dado de baja (o se justifica que no corresponde).
--
-- La asignacion agente->residencia se carga con scripts/seed_residencias.mjs,
-- que cruza el "Listado de residentes" por nombre y es re-ejecutable.

CREATE TABLE IF NOT EXISTS residencias (
  id            INT          NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(120) NOT NULL,
  anios         INT          NOT NULL DEFAULT 4 COMMENT 'Cuantos anios dura la residencia',
  activa        TINYINT(1)   NOT NULL DEFAULT 1,
  observaciones VARCHAR(500) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_residencias_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS residentes_residencia (
  dni           INT          NOT NULL,
  residencia_id INT          NOT NULL,
  fecha_inicio  DATE         NULL COMMENT 'Si esta vacia se usa agentes.fecha_ingreso',
  observaciones VARCHAR(500) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dni),
  KEY idx_residentes_residencia_res (residencia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS residencias_bajas (
  id                  INT          NOT NULL AUTO_INCREMENT,
  dni                 INT          NOT NULL,
  ciclo               INT          NOT NULL COMMENT 'Anio del corte',
  residencia_id       INT          NULL,
  residencia_nombre   VARCHAR(120) NULL,
  anios_cumplidos     INT          NULL,
  anios_residencia    INT          NULL,
  fecha_corte         DATE         NOT NULL,
  estado              ENUM('PENDIENTE','BAJA','NO_CORRESPONDE') NOT NULL DEFAULT 'PENDIENTE',
  fecha_baja          DATE         NULL,
  observaciones       VARCHAR(500) NULL,
  resuelto_por        INT          NULL,
  resuelto_por_nombre VARCHAR(200) NULL,
  resuelto_at         DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_residencias_bajas (dni, ciclo),
  KEY idx_residencias_bajas_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catalogo inicial (listado de residentes del hospital).
-- DERECHO Y SALUD y PRE RESIDENTES quedan con duracion tentativa, a confirmar.
INSERT IGNORE INTO residencias (nombre, anios, observaciones) VALUES
  ('TERAPIA INTENSIVA', 4, NULL),
  ('CIRUGIA GENERAL',   4, NULL),
  ('TRAUMATOLOGIA',     4, NULL),
  ('CLINICA MEDICA',    4, NULL),
  ('TOCOGINECOLOGIA',   4, NULL),
  ('ANESTESIOLOGIA',    4, NULL),
  ('TRABAJO SOCIAL',    3, NULL),
  ('FONOAUDIOLOGIA',    3, NULL),
  ('DERECHO Y SALUD',   3, 'Duracion a confirmar'),
  ('PRE RESIDENTES',    1, 'Duracion a confirmar');
