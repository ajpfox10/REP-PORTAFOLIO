-- 062 — Legajo Personal (formulario oficial PBA / Ministerio de Salud): tablas faltantes
-- Carga MANUAL de todas las hojas. Las tablas también se crean solas en runtime
-- (legajo.routes.ts → ensureLegajoTables), así que este archivo queda como registro.
-- Idempotente: CREATE TABLE IF NOT EXISTS; las columnas/FKs nuevas las agrega el runtime
-- después de verificar information_schema (MySQL 8 no tiene ADD COLUMN IF NOT EXISTS).

-- Hoja 2 — 1) Datos personales: lo que no está en `personal` (1 fila por DNI)
CREATE TABLE IF NOT EXISTS legajo_datos_personales (
  dni                           INT          NOT NULL PRIMARY KEY,
  nro_legajo                    VARCHAR(30)  NULL,
  reparticion                   VARCHAR(200) NULL,
  -- a) Filiación
  nac_pais                      VARCHAR(100) NULL,
  nac_provincia                 VARCHAR(100) NULL,
  nac_partido                   VARCHAR(150) NULL,
  estado_civil                  VARCHAR(20)  NULL,
  -- b) Identidad
  clase                         VARCHAR(10)  NULL,
  dist_militar                  VARCHAR(60)  NULL,
  cedula_nro                    VARCHAR(30)  NULL,
  cedula_expedida_por           VARCHAR(150) NULL,
  carta_ciudadania              VARCHAR(60)  NULL,
  carta_otorgada_en             VARCHAR(150) NULL,
  carta_fecha                   DATE         NULL,
  carta_juez_federal            VARCHAR(150) NULL,
  -- c) Aptitud
  estudios_nivel                VARCHAR(30)  NULL,
  estudios_detalle              VARCHAR(250) NULL,
  titulo_secundario             VARCHAR(200) NULL,
  titulo_secundario_otorgado    VARCHAR(200) NULL,
  titulo_universitario          VARCHAR(200) NULL,
  titulo_universitario_otorgado VARCHAR(200) NULL,
  aptitud_especial              VARCHAR(250) NULL,
  -- d) Servicios militares
  mil_presto                    TINYINT(1)   NULL,
  mil_arma                      VARCHAR(100) NULL,
  mil_especialidad              VARCHAR(100) NULL,
  mil_grado                     VARCHAR(100) NULL,
  mil_destino                   VARCHAR(150) NULL,
  mil_motivo_excepcion          VARCHAR(200) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT NULL,
  updated_by INT NULL,
  CONSTRAINT fk_legajo_datos_personales_dni FOREIGN KEY (dni) REFERENCES personal(dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hoja 3 — Rectificaciones (al dorso de datos personales)
CREATE TABLE IF NOT EXISTS legajo_rectificaciones (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni         INT          NOT NULL,
  seccion     ENUM('FILIACION','IDENTIDAD','APTITUD') NOT NULL,
  fecha       DATE         NULL,
  norma_legal VARCHAR(150) NULL,
  texto       TEXT         NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  KEY ix_legajo_rectificaciones_dni (dni),
  CONSTRAINT fk_legajo_rectificaciones_dni FOREIGN KEY (dni) REFERENCES personal(dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hoja 6 — 3) Foja de servicios (renglones manuales)
CREATE TABLE IF NOT EXISTS legajo_foja_servicios (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni              INT          NOT NULL,
  resolucion       VARCHAR(120) NULL,
  fecha_ingreso    DATE         NULL,
  ministerio       VARCHAR(150) NULL,
  dependencia      VARCHAR(200) NULL,
  cargo            VARCHAR(200) NULL,
  grupo_ocupacional VARCHAR(20) NULL,
  categoria        VARCHAR(30)  NULL,
  regimen_horario  VARCHAR(60)  NULL,
  fecha_baja       DATE         NULL,
  motivo           VARCHAR(300) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  KEY ix_legajo_foja_servicios_dni (dni),
  CONSTRAINT fk_legajo_foja_servicios_dni FOREIGN KEY (dni) REFERENCES personal(dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hoja 10 — 6) Licencias concepto 06 (formulario 55/80)
CREATE TABLE IF NOT EXISTS legajo_licencias_06 (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni               INT          NOT NULL,
  codigo_trabajo    VARCHAR(2)   NULL,
  concepto          VARCHAR(2)   NULL DEFAULT '06',
  subconcepto       VARCHAR(2)   NULL,
  inciso            VARCHAR(1)   NULL,
  legajo_contaduria VARCHAR(7)   NULL,
  norma_codigo      VARCHAR(1)   NULL,
  norma_numero      VARCHAR(5)   NULL,
  norma_anio        VARCHAR(4)   NULL,
  fecha_desde       DATE         NULL,
  fecha_hasta       DATE         NULL,
  dias_con_sueldo   SMALLINT     NULL,
  dias_50           SMALLINT     NULL,
  dias_sin_sueldo   SMALLINT     NULL,
  acum_con_sueldo   SMALLINT     NULL,
  acum_50           SMALLINT     NULL,
  acum_sin_sueldo   SMALLINT     NULL,
  observaciones     TEXT         NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  KEY ix_legajo_licencias_06_dni (dni),
  CONSTRAINT fk_legajo_licencias_06_dni FOREIGN KEY (dni) REFERENCES personal(dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hoja 13 — 9) Domicilio (historial)
CREATE TABLE IF NOT EXISTS legajo_domicilios (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni                 INT          NOT NULL,
  expediente          VARCHAR(100) NULL,
  fecha               DATE         NULL,
  calle_numero        VARCHAR(250) NULL,
  telefono            VARCHAR(60)  NULL,
  partido             VARCHAR(150) NULL,
  localidad           VARCHAR(150) NULL,
  codigo_partido      VARCHAR(20)  NULL,
  codigo_localidad    VARCHAR(20)  NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  KEY ix_legajo_domicilios_dni (dni),
  CONSTRAINT fk_legajo_domicilios_dni FOREIGN KEY (dni) REFERENCES personal(dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Hoja 14 — 10) Incompatibilidad: columnas nuevas (las agrega el runtime si faltan)
--   jubilacion_tipo VARCHAR(20), cargo_nacional VARCHAR(250), cargo_provincial VARCHAR(250),
--   cargo_municipal VARCHAR(250), otro_cargo_horario VARCHAR(200)
-- FKs dni → personal(dni) en las legajo_* viejas (las agrega el runtime si faltan y no hay huérfanos).
