-- 055__mapeo_novedades.sql
-- Mapeo UNICO novedad SIAPE -> novedad Ministerio (Intranet MS).
-- Reemplaza: DEFAULT_MAPEO de comparacionSiape.routes.ts y asistencia.routes.ts
-- + apifront/mapeo.asistencia.json (que leen los robots de carga).
--
-- codigo_cie = '' -> regla general de esa novedad SIAPE.
-- codigo_cie = 'J11' (CIE de LICENCIAS_MEDICAS.CODIGO_OMS) -> regla para esa
--   enfermedad; al cargar GANA sobre la general (ej. ENFERMEDAD+CIE -> 1R).
-- usar_para_cargar = 1 -> es la que carga el robot; 0 -> solo equivalencia
--   para el comparador (ENFERMEDAD coincide con 01, 1R y E del Ministerio).
--   Maximo UNA fila de carga por (novedad_siape, codigo_cie): lo garantiza uq_carga.
-- Carga inicial = mapeo vigente; usar_para_cargar replica lo que carga hoy el
-- robot (primer codigo del JSON para cada novedad SIAPE). Idempotente.

CREATE TABLE IF NOT EXISTS mapeo_novedades (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  novedad_siape VARCHAR(150) NOT NULL,
  codigo_cie VARCHAR(20) NOT NULL DEFAULT '',
  novedad_ministerio VARCHAR(150) NOT NULL,
  usar_para_cargar TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  observacion VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  carga_key VARCHAR(180) GENERATED ALWAYS AS (
    IF(usar_para_cargar = 1 AND activo = 1, CONCAT(novedad_siape, '|', codigo_cie), NULL)
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mapeo (novedad_siape, codigo_cie, novedad_ministerio),
  UNIQUE KEY uq_carga (carga_key),
  KEY idx_mapeo_ministerio (novedad_ministerio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO mapeo_novedades (novedad_siape, codigo_cie, novedad_ministerio, usar_para_cargar, observacion) VALUES
  ('01-POR RAZONES DE ENFERMEDAD', '', '01-POR RAZONES DE ENFERMEDAD', 0, 'inicial: asistencia'),
  ('04-POR ACCIDENTE DE TRABAJO', '', '04-POR ACCIDENTE DE TRABAJO', 0, 'inicial: asistencia'),
  ('05-POR ATENCION DE FAMILIAR ENFERMO', '', '05-POR ATENCION DE FAMILIAR ENFERMO', 0, 'inicial: asistencia'),
  ('06-POR MATERNIDAD', '', '06-POR MATERNIDAD', 0, 'inicial: asistencia'),
  ('08-DESCANSO ANUAL', '', '08-DESCANSO ANUAL', 0, 'inicial: asistencia'),
  ('14-DUELO FAMILIAR DIRECTO', '', '14-DUELO FAMILIAR DIRECTO', 0, 'inicial: asistencia'),
  ('15-DUELO FAMILIAR INDIRECTO', '', '15-DUELO FAMILIAR INDIRECTO', 0, 'inicial: asistencia'),
  ('16-POR MATRIMONIO', '', '16-POR MATRIMONIO', 0, 'inicial: asistencia'),
  ('17-POR PRE-EXAMEN', '', '17-POR PRE-EXAMEN', 0, 'inicial: asistencia'),
  ('18-POR EXAMEN', '', '18-POR EXAMEN', 0, 'inicial: asistencia'),
  ('1R-ENFERMEDAD DE RIESGO', '', '1R-ENFERMEDAD DE RIESGO', 0, 'inicial: asistencia'),
  ('22-ACTIVIDAD GREMIAL', '', '22-ACTIVIDAD GREMIAL', 0, 'inicial: asistencia'),
  ('261-POR CAUSAS PARTICULARES', '', '261-POR CAUSAS PARTICULARES', 0, 'inicial: asistencia'),
  ('29-COMPLEMENTARIA', '', '29-COMPLEMENTARIA', 0, 'inicial: asistencia'),
  ('291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.', '', '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.', 0, 'inicial: asistencia'),
  ('44-PERMISO CITACIONES ORG.OFICIAL', '', '44-PERMISO CITACIONES ORG.OFICIAL', 0, 'inicial: asistencia'),
  ('81-LICENCIA ANTERIOR DENEGADA', '', '81-LICENCIA ANTERIOR DENEGADA', 0, 'inicial: asistencia'),
  ('93-LICENCIA COMPLEMENT.ANT.DENEGADA', '', '93-LICENCIA COMPLEMENT.ANT.DENEGADA', 0, 'inicial: asistencia'),
  ('ACCIDENTE DE TRABAJO', '', '04-POR ACCIDENTE DE TRABAJO', 1, 'inicial: json'),
  ('ANUAL', '', '08-DESCANSO ANUAL', 1, 'inicial: json'),
  ('ANUAL', '', '81-LICENCIA ANTERIOR DENEGADA', 0, 'inicial: asistencia'),
  ('ANUAL COMPLEMENTARIA', '', '29-COMPLEMENTARIA', 1, 'inicial: json'),
  ('ANUAL COMPLEMENTARIA', '', '93-LICENCIA COMPLEMENT.ANT.DENEGADA', 0, 'inicial: asistencia'),
  ('ANUAL COMPLEMENTARIA 10430', '', '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.', 1, 'inicial: json'),
  ('ATENCION FAMILIAR ENFERMO', '', '05-POR ATENCION DE FAMILIAR ENFERMO', 1, 'inicial: json'),
  ('ATENCION FAMILIAR ENFERMO', '', 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)', 0, 'inicial: asistencia'),
  ('CAUSAS PARTICULARES', '', '261-POR CAUSAS PARTICULARES', 1, 'inicial: json'),
  ('CITACION ORG OFICIALES', '', '44-PERMISO CITACIONES ORG.OFICIAL', 1, 'inicial: json'),
  ('CITACION ORG.OFICIALES', '', '44-PERMISO CITACIONES ORG.OFICIAL', 1, 'inicial: json'),
  ('CITACION ORGANISMOS OFICIALES', '', '44-PERMISO CITACIONES ORG.OFICIAL', 1, 'inicial: json'),
  ('COMISION', '', '22-ACTIVIDAD GREMIAL', 0, 'inicial: asistencia'),
  ('CUIDADO RECIEN NACIDO/A', '', '06-POR MATERNIDAD', 1, 'inicial: json'),
  ('CUIDADO RECIEN NACIDO/A', '', 'RN1-RECIEN NACIDO', 0, 'inicial: json'),
  ('DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', '', 'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', 0, 'inicial: asistencia'),
  ('DUELO DIRECTO', '', '15-DUELO FAMILIAR INDIRECTO', 1, 'inicial: json'),
  ('DUELO DIRECTO', '', '14-DUELO FAMILIAR DIRECTO', 0, 'inicial: asistencia'),
  ('DUELO INDIRECTO', '', '15-DUELO FAMILIAR INDIRECTO', 1, 'inicial: json'),
  ('E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)', '', 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)', 0, 'inicial: asistencia'),
  ('ENFERMEDAD', '', '01-POR RAZONES DE ENFERMEDAD', 1, 'inicial: json'),
  ('ENFERMEDAD', '', '1R-ENFERMEDAD DE RIESGO', 0, 'inicial: json'),
  ('ENFERMEDAD', '', 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)', 0, 'inicial: asistencia'),
  ('ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE', '', '05-POR ATENCION DE FAMILIAR ENFERMO', 1, 'inicial: json'),
  ('ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE', '', 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)', 0, 'inicial: asistencia'),
  ('EX.MED.PREV.CANCER MAMARIO/PROSTATA/COLON', '', 'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', 1, 'inicial: json'),
  ('EX.MED.PREV.CANCER MAMARIO/PROSTATA/COLON', '', 'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON', 0, 'inicial: json'),
  ('EXAMEN', '', '18-POR EXAMEN', 1, 'inicial: json'),
  ('INTEGRACION DE MESA EXAMINADORA', '', '22-ACTIVIDAD GREMIAL', 1, 'inicial: json'),
  ('INTEGRACION DE MESA EXAMINADORA', '', '18-POR EXAMEN', 0, 'inicial: asistencia'),
  ('MATERNIDAD', '', '06-POR MATERNIDAD', 1, 'inicial: json'),
  ('MATRIMONIO', '', '16-POR MATRIMONIO', 1, 'inicial: json'),
  ('MUJER VICTIMA DE VIOLENCIA', '', 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', 0, 'inicial: asistencia'),
  ('NACIMIENTO', '', '06-POR MATERNIDAD', 1, 'inicial: json'),
  ('NACIMIENTO', '', 'RN1-RECIEN NACIDO', 0, 'inicial: asistencia'),
  ('NACIMIENTO CORRESPONSABLE PARENTAL MULTIPLE', '', '312-PATERNIDAD/CORRESPONSAL PARENTAL NACIMIENTO MULTIPLE', 0, 'inicial: comparador'),
  ('NACIMIENTO PREMATURO ALTO RIESGO', '', '06-POR MATERNIDAD', 1, 'inicial: json'),
  ('PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', '', 'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', 1, 'inicial: json'),
  ('PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA', '', 'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON', 0, 'inicial: json'),
  ('PARA MUJERES VICTIMAS DE VIOLENCIA', '', 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', 0, 'inicial: asistencia'),
  ('PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON', '', 'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON', 0, 'inicial: asistencia'),
  ('PERMISO GREMIAL DIAS', '', '22-ACTIVIDAD GREMIAL', 1, 'inicial: json'),
  ('PRE-EXAMEN', '', '17-POR PRE-EXAMEN', 1, 'inicial: json'),
  ('RN1-RECIEN NACIDO', '', 'RN1-RECIEN NACIDO', 0, 'inicial: asistencia'),
  ('VICTIMA DE VIOLENCIA DE GENERO', '', 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', 0, 'inicial: asistencia'),
  ('VIOLENCIA DE GENERO', '', 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', 0, 'inicial: asistencia'),
  ('VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', '', 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO', 0, 'inicial: asistencia');
