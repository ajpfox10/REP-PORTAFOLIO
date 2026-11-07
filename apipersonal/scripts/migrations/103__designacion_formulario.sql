-- 103: datos del agente para Designaciones del Ministerio (pedido 01/11/2026).
--   Lo que pide el wizard de sistemas.ms.gba.gov.ar/grh/designaciones y no está en la base;
--   lo carga el importador del formulario de Google (D:\G\designacion_formulario.gs).
--   Las columnas se llaman como los campos del sistema del Ministerio (ver
--   docs/grh_designaciones_mapa.md) para que el robot de carga pase cada dato derecho.
--   Nacionalidad, estado civil y domicilio NO están acá: salen de personal / personalv3 /
--   listado de domicilios del Ministerio.
--   Sí/No = TINYINT 1/0 (igual que el sistema); NULL = no respondió.

-- Paso 1 (estudios, extranjero), paso 2 (DDJJ 17 preguntas), paso 5 (otra repartición) y paso 6 (chofer)
CREATE TABLE IF NOT EXISTS designacion_form_datos (
  dni                       INT NOT NULL PRIMARY KEY,
  fecha_formulario          DATE NULL COMMENT 'marca temporal de la respuesta importada',
  email                     VARCHAR(120) NULL,
  telefono                  VARCHAR(10) NULL,
  fechaingresoarg           DATE NULL COMMENT 'solo nacidos en el exterior',
  secundario_estado         ENUM('completo','incompleto','no_curso') NULL,
  titulo_secundario         VARCHAR(50) NULL,
  universitario_estado      ENUM('completo','incompleto','no_curso') NULL,
  titulo_universitario      VARCHAR(50) NULL,
  f2p1  TINYINT(1) NULL, f2p2  TINYINT(1) NULL, f2p3  TINYINT(1) NULL, f2p4  TINYINT(1) NULL,
  f2p5  TINYINT(1) NULL, f2p6  TINYINT(1) NULL, f2p7  TINYINT(1) NULL, f2p8  TINYINT(1) NULL,
  f2p9  TINYINT(1) NULL, f2p10 TINYINT(1) NULL, f2p11 TINYINT(1) NULL, f2p12 TINYINT(1) NULL,
  f2p13 TINYINT(1) NULL, f2p14 TINYINT(1) NULL, f2p15 TINYINT(1) NULL, f2p16 TINYINT(1) NULL,
  f2p17 TINYINT(1) NULL,
  descripcioncargo          VARCHAR(500) NULL COMMENT 'p1 Sí: modalidad y situación de revista',
  refEntidadCertificante    TINYINT UNSIGNED NULL COMMENT 'p3 Sí: id del select del Ministerio (13 Médicos, 29 SIN COLEGIACION)',
  nromatricula              VARCHAR(9) NULL,
  cargodesempena            VARCHAR(100) NULL COMMENT 'p5 Sí',
  expedienterespaldo        VARCHAR(100) NULL COMMENT 'p6 Sí',
  fretirovoluntario         DATE NULL COMMENT 'p10 Sí',
  revista_otra_reparticion  ENUM('no','mismo_ministerio','otro_ministerio') NULL,
  nombre_reparticion_otra   VARCHAR(50) NULL COMMENT 'mismo: nombre_reparticion_mismo_ministerio / otro: nombre_reparticion_otro_ministerio',
  ministerio_organismo_otro VARCHAR(50) NULL COMMENT 'solo otro_ministerio',
  tipo_reparticion          ENUM('publica','privada') NULL COMMENT 'solo otro_ministerio',
  cargo_otra                VARCHAR(50) NULL,
  agrupamiento_otra         VARCHAR(50) NULL,
  categoria_otra            VARCHAR(50) NULL,
  regimen_horario_otra      TINYINT UNSIGNED NULL COMMENT 'horas semanales',
  observaciones_otra        VARCHAR(200) NULL,
  es_chofer                 TINYINT(1) NULL,
  nro_licencia              VARCHAR(8) NULL,
  inhabilitado_conducir     TINYINT(1) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT NULL,
  updated_by INT NULL,
  CONSTRAINT fk_desig_form_datos_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_desig_form_datos_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_desig_form_datos_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Banda horaria semanal en la otra repartición (dia 1 = Lunes … 7 = Domingo)
CREATE TABLE IF NOT EXISTS designacion_form_otra_banda (
  dni      INT NOT NULL,
  dia      TINYINT UNSIGNED NOT NULL,
  desde    TIME NOT NULL,
  hasta    TIME NOT NULL,
  guardia  TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (dni, dia),
  CONSTRAINT chk_desig_banda_dia CHECK (dia BETWEEN 1 AND 7),
  CONSTRAINT fk_desig_banda_dni FOREIGN KEY (dni) REFERENCES designacion_form_datos(dni)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Paso 1 — cursos (designacion_paso1[cursos][N][...])
CREATE TABLE IF NOT EXISTS designacion_form_cursos (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni          INT NOT NULL,
  nombrecurso  VARCHAR(50) NOT NULL,
  institucion  VARCHAR(50) NULL,
  fechadesde   DATE NULL,
  fechahasta   DATE NULL,
  canthoras    SMALLINT UNSIGNED NULL,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   INT NULL,
  KEY idx_desig_cursos_dni (dni),
  CONSTRAINT fk_desig_cursos_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_desig_cursos_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Paso 4 — experiencia laboral (designacion_paso4[antecedentes][N][...])
CREATE TABLE IF NOT EXISTS designacion_form_experiencias (
  id                      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni                     INT NOT NULL,
  empresa                 VARCHAR(50) NOT NULL,
  cargo                   VARCHAR(50) NULL,
  fechadesde              DATE NULL,
  fechahasta              DATE NULL,
  trabajo_actualmente     TINYINT(1) NULL,
  reftipoactividad        TINYINT UNSIGNED NULL COMMENT '1 PUBLICA, 2 PRIVADA',
  refambito               TINYINT UNSIGNED NULL COMMENT '1 Municipal, 2 Provincial, 3 Nacional (solo pública)',
  nomarchivocomprenuncia  TINYINT(1) NULL COMMENT 'compromiso de renuncia',
  created_at              TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_by              INT NULL,
  KEY idx_desig_exp_dni (dni),
  CONSTRAINT fk_desig_exp_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_desig_exp_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Paso 3 — DDJJ de salud (designacion_paso3[salud][...]); checks 1 = marcado
CREATE TABLE IF NOT EXISTS designacion_form_salud (
  dni INT NOT NULL PRIMARY KEY,
  DCpeso VARCHAR(6) NULL, DCaltura VARCHAR(4) NULL,
  AVMiopia TINYINT(1) NULL, AVAstigmatismo TINYINT(1) NULL, AVPresionocular TINYINT(1) NULL, AVOtras VARCHAR(200) NULL,
  AAZumbidos TINYINT(1) NULL, AASordera TINYINT(1) NULL, AAOtitis TINYINT(1) NULL, AADisminucion TINYINT(1) NULL,
  AAAudifonos TINYINT(1) NULL, AAOtras VARCHAR(200) NULL,
  AQCirugias VARCHAR(200) NULL,
  HFumo TINYINT(1) NULL COMMENT 'UI del sistema: #fumo_checkbox', HFumofinicio DATE NULL, HFumofcese DATE NULL,
  HBebeSi TINYINT(1) NULL COMMENT 'UI del sistema: #bebe_checkbox', HBebe VARCHAR(100) NULL, HBebeVasos TINYINT UNSIGNED NULL,
  HBebefinicio DATE NULL, HBebefcese DATE NULL,
  HConsumeSi TINYINT(1) NULL COMMENT 'UI del sistema: #consume_checkbox', HConsume VARCHAR(100) NULL,
  HConsumefinicio DATE NULL, HConsumefcese DATE NULL,
  VBcg TINYINT(1) NULL, VHepatitis TINYINT(1) NULL, VAntigripal TINYINT(1) NULL, VCovid TINYINT(1) NULL,
  VDobleadulto TINYINT(1) NULL, VOtras VARCHAR(100) NULL,
  AmDiabetes TINYINT(1) NULL, AmColesterol TINYINT(1) NULL, AmGota TINYINT(1) NULL, AmTiroides TINYINT(1) NULL,
  Fechauas DATE NULL,
  AcGastritis TINYINT(1) NULL, AcUlceras TINYINT(1) NULL, AcCalculos TINYINT(1) NULL, AcHepatitis TINYINT(1) NULL,
  AcPancreatitis TINYINT(1) NULL, AcInfUrinarias TINYINT(1) NULL, AcHemorroides TINYINT(1) NULL,
  AcEventraciones TINYINT(1) NULL, AcApendicitis TINYINT(1) NULL, AcEnfRenales TINYINT(1) NULL,
  AcVesicula TINYINT(1) NULL, AcHernias TINYINT(1) NULL, AcOtras VARCHAR(100) NULL,
  AcaPalpitaciones TINYINT(1) NULL, AcaInfartos TINYINT(1) NULL, AcaCCongenita TINYINT(1) NULL,
  AcaInsuficiencia TINYINT(1) NULL, AcaDolor TINYINT(1) NULL, AcaMarcapasos TINYINT(1) NULL,
  AcaPresionAlta VARCHAR(3) NULL, AcaOtras VARCHAR(100) NULL,
  Artuberculosis TINYINT(1) NULL, ArBroncoespasmos TINYINT(1) NULL, ArAlergias TINYINT(1) NULL, ArAsma TINYINT(1) NULL,
  ArNeumonias TINYINT(1) NULL, ArEPOC TINYINT(1) NULL, ArOtras VARCHAR(100) NULL,
  AalMalformaciones TINYINT(1) NULL, AalAmputaciones TINYINT(1) NULL, AalHernia TINYINT(1) NULL,
  AalPerdidaFuerza TINYINT(1) NULL, AalProtesis TINYINT(1) NULL, AalDesviacioncolumna TINYINT(1) NULL,
  AalOtras VARCHAR(100) NULL,
  ANcefalea TINYINT(1) NULL, AnACV TINYINT(1) NULL, AnConvulsiones TINYINT(1) NULL, AnEpilepsia TINYINT(1) NULL,
  AnParalisis TINYINT(1) NULL, AnPerdidaconocimiento TINYINT(1) NULL, AnOtras VARCHAR(100) NULL,
  AGControlGineco2anos TINYINT(1) NULL, AGFamDirectosEnfOnco TINYINT(1) NULL, AGPapanicolao2anos TINYINT(1) NULL,
  AGMamografia2anos TINYINT(1) NULL, AGEmbarazos TINYINT(1) NULL, AGPresionduranteembarazo TINYINT(1) NULL,
  AGDiabetesduranteembarazo TINYINT(1) NULL, AGOtras VARCHAR(100) NULL,
  AANDificultadOrinar TINYINT(1) NULL, AANDificultadOrinaCompleta TINYINT(1) NULL,
  AANCtrolProstatico1ano TINYINT(1) NULL, AANUrologia1ano TINYINT(1) NULL, AANOtras VARCHAR(100) NULL,
  CUD TINYINT(1) NULL, CUDtramite TINYINT(1) NULL, CUDPatologia VARCHAR(100) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT NULL,
  updated_by INT NULL,
  CONSTRAINT fk_desig_salud_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_desig_salud_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_desig_salud_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
