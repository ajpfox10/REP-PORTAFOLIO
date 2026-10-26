-- 090: historial de horarios de SIAPE (pedido 24/10/2026, pestaña Fichajes de Asistencia).
--   HORARIOS.xlsx (consulta 76 "Horario Administrativo a un dia") es solo el horario de HOY; para comparar
--   fichadas viejas hace falta el horario que tenía el agente en esa fecha.
--   · horarios_historial: una "foto" por agente y fecha consultada (el horario vigente ese día).
--     Hora 'HH:MM', NULL = ese día no trabaja ('-' en SIAPE). Sin FK a personal: SIAPE trae DNIs que no están.
--   · horarios_historial_cargas: qué fechas ya se bajaron (el robot retoma donde quedó).
--       origen 'historial' = robot siape_horarios_historial (día 1 de cada mes desde 01/2018)
--       origen 'diario'    = la exportación diaria de HORARIOS.xlsx (siape_horario_admin_dia)
--   Para una fecha D se usa la foto más reciente <= D del agente.

CREATE TABLE IF NOT EXISTS horarios_historial (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fecha DATE NOT NULL,
  dni INT UNSIGNED NOT NULL,
  apellido_nombre VARCHAR(150) NULL,
  lun_e CHAR(5) NULL, lun_s CHAR(5) NULL,
  mar_e CHAR(5) NULL, mar_s CHAR(5) NULL,
  mie_e CHAR(5) NULL, mie_s CHAR(5) NULL,
  jue_e CHAR(5) NULL, jue_s CHAR(5) NULL,
  vie_e CHAR(5) NULL, vie_s CHAR(5) NULL,
  sab_e CHAR(5) NULL, sab_s CHAR(5) NULL,
  dom_e CHAR(5) NULL, dom_s CHAR(5) NULL,
  regimen VARCHAR(100) NULL,
  planta VARCHAR(60) NULL,
  agrupamiento VARCHAR(60) NULL,
  estructura VARCHAR(300) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_horarios_historial (dni, fecha),
  KEY idx_horarios_historial_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS horarios_historial_cargas (
  fecha DATE NOT NULL,
  origen ENUM('historial','diario') NOT NULL,
  archivo VARCHAR(300) NULL,
  filas INT NOT NULL DEFAULT 0,
  cargado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_hora,
   destino_nombre, destino_editable, notas, activo)
VALUES
  ('siape_horarios_historial', 'Historial de horarios (consulta 76, desde 2018)', 'Exportaciones SIAPE', 14,
   'python siape_exportaciones/horarios_historial.py', 0, 0, '', NULL,
   'HORARIOS_HISTORIAL\\HORARIOS_AAAA-MM-DD.xlsx + tabla horarios_historial', 0,
   'Baja "Horario Administrativo a un dia" con el día 1 de cada mes desde 01/01/2018 hasta hoy y lo carga en horarios_historial. Solo baja las fechas que faltan: la primera vez tarda (~1 min por mes), después solo agrega el mes nuevo. Lo usa la pestaña Fichajes de Asistencia.',
   1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), comando = VALUES(comando), notas = VALUES(notas);
