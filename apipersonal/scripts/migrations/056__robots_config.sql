-- 056__robots_config.sql
-- Catálogo + configuración de los robots (página Herramientas -> Robots SIAPE).
-- Reemplaza el CATALOGO que estaba escrito en scriptRuns.routes.ts.
--
-- comando: lo que se ejecuta, relativo a apipersonal/scripts. NO se edita desde
--   la página (solo se corren robots de esta tabla).
-- reporta_solo = 1: el script ya escribe su fila en script_runs (exportaciones,
--   Intranet); 0: lo envuelve run_robot.py, que registra exit code, duración y log.
-- Programación (la usa el despachador, fase 2): prog_activa, prog_dias
--   ('LU,MA,MI,JU,VI,SA,DO' o vacío = todos), prog_cada_n_dias, prog_hora.
-- tarea_windows: tarea del Programador de Windows que HOY lo corre (referencia;
--   se pasa al despachador después de probarlo).
-- destino_dir / destino_nombre: dónde deja el archivo. destino_editable = 0 por
--   ahora: se muestra en la página y se habilita después de probar.
-- lo_leen: quién lee ese archivo (aviso antes de cambiar nombre/carpeta).

CREATE TABLE IF NOT EXISTS robots_config (
  script VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  grupo VARCHAR(60) NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  comando VARCHAR(500) NULL,
  reporta_solo TINYINT(1) NOT NULL DEFAULT 0,
  prog_activa TINYINT(1) NOT NULL DEFAULT 0,
  prog_dias VARCHAR(40) NOT NULL DEFAULT '',
  prog_cada_n_dias INT NULL,
  prog_hora TIME NULL,
  tarea_windows VARCHAR(120) NULL,
  destino_dir VARCHAR(300) NULL,
  destino_nombre VARCHAR(200) NULL,
  destino_editable TINYINT(1) NOT NULL DEFAULT 0,
  lo_leen VARCHAR(300) NULL,
  notas VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (script)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  -- Exportaciones SIAPE (Gestor de Exportaciones, robot JAB)
  ('siape_examenes_medicos', 'Exportación Exámenes Médicos Salud (SIAPE)', 'Exportaciones SIAPE', 10,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Examenes Médicos Salud"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'EXAMENES_MEDICOS.xlsx', NULL, 'Modal PERIODO: año en curso'),
  ('siape_horario_admin_dia', 'Exportación Horario Administrativo a un día (SIAPE)', 'Exportaciones SIAPE', 11,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Horario Administrativo a un dia"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'HORARIOS.xlsx', 'Turnos >10h, ausentismo por carpeta médica, horarios', 'Modal FECHA: hoy'),
  ('siape_horario_admin_consolidado', 'Exportación Horario Administrativo Consolidado (SIAPE)', 'Exportaciones SIAPE', 12,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Horario Administrativo Consolidado de los Agentes"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'HORARIO_CONSOLIDADO.xlsx', NULL, 'Sin fechas'),
  ('siape_horario_guardia_dia', 'Exportación Horario Guardia Salud a un día (SIAPE)', 'Exportaciones SIAPE', 13,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Horario Guardia Salud a un dia"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'HORARIO_GUARDIA.xlsx', NULL, 'Modal FECHA: hoy'),
  ('siape_licencias_medicas', 'Exportación Licencias Médicas (SIAPE)', 'Exportaciones SIAPE', 14,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Licencias Médicas"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'LICENCIAS_MEDICAS.xlsx', 'Robot de carga Intranet (CIE), Licencias de Consultorio', 'Modal PERIODO: día 1 del mes a fin de año'),
  ('siape_novedades_pendientes', 'Exportación Novedades Pendientes de Autorización (SIAPE)', 'Exportaciones SIAPE', 15,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Novedades Pendientes de Autorización"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'NOVEDADES_PENDIENTES.xlsx', NULL, 'Sin fechas'),
  ('siape_novedades_por_periodo', 'Exportación Novedades Por Periodo (SIAPE)', 'Exportaciones SIAPE', 16,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Novedades Por Periodo"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion\\SIAPE', 'SIAPE.xlsx', 'Comparador SIAPE (toma el PRIMER Excel de la carpeta), robots Intranet, ausentes', 'Modal PERIODO: día 1 del mes a fin de año'),
  ('siape_novedades_rechazadas', 'Exportación Novedades Rechazadas (SIAPE)', 'Exportaciones SIAPE', 17,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Novedades Rechazadas"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'NOVEDADES_RECHAZADAS.xlsx', NULL, 'Modal FECHA: hoy'),
  ('siape_plantel_nominado', 'Exportación Plantel Nominado (SIAPE)', 'Exportaciones SIAPE', 18,
   'python siape_exportaciones/descargar_exportacion_siape.py --consulta "Plantel Nominado"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'plantel nominado.xlsx', NULL, 'Sin fechas'),

  -- SIAPE: descarga Discoverer + carga/corrección de stress + francos
  ('siape_tiempo_acumulado', 'Descarga Tiempo Acumulado (Discoverer)', 'SIAPE', 20,
   'node siape_stress/bajar_tiempo_acumulado.mjs', 0, '', 3, '16:30:00', 'SIAPE_Bajar_TiempoAcumulado',
   'D:\\G\\comparacion', 'TIEMPO ACUMULADO.xls', 'Carga de stress (cola ANUAL COMPLEMENTARIA)', 'Año anterior al en curso'),
  ('siape_carga_stress', 'Carga ANUAL COMPLEMENTARIA (stress) en SIAPE', 'SIAPE', 21,
   'node siape_stress/cargar_stress.mjs --all', 0, '', 1, '17:00:00', 'SIAPE_Carga_Stress',
   NULL, NULL, NULL, 'Robot JAB; necesita la sesión de Windows abierta'),
  ('siape_corrector_stress', 'Corrector de días de stress en SIAPE', 'SIAPE', 22,
   'python corregir_stress_jab.py', 0, '', NULL, NULL, NULL,
   NULL, NULL, NULL, 'Lee la cola cola_correccion_stress'),
  ('siape_carga_francos', 'Carga de francos compensatorios en SIAPE', 'SIAPE', 23,
   'python cargar_francos_siape.py', 0, 'MA,JU', NULL, '20:00:00', 'SIAPE_Carga_Francos',
   NULL, NULL, NULL, 'Robot JAB; necesita la sesión de Windows abierta'),

  -- Intranet del Ministerio de Salud (Playwright; el login puede pedir reCAPTCHA)
  ('intranet_carga_novedades_hospital', 'Carga de novedades en Intranet MS (HOSPITAL)', 'Intranet MS', 30,
   'python cargar_vacaciones_intranet.py --dependencia HOSPITAL', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'resultado_carga.xlsx', 'Comparador SIAPE (resultado de la carga)', 'Mapeo por tabla + CIE; examen automático tras pre-examen'),
  ('intranet_carga_novedades_upa4', 'Carga de novedades en Intranet MS (UPA 4)', 'Intranet MS', 31,
   'python cargar_vacaciones_intranet.py --dependencia "UPA 4"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'resultado_carga_upa4.xlsx', 'Comparador SIAPE (resultado de la carga)', NULL),
  ('intranet_carga_novedades_upa18', 'Carga de novedades en Intranet MS (UPA 18)', 'Intranet MS', 32,
   'python cargar_vacaciones_intranet.py --dependencia "UPA 18"', 1, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'resultado_carga_upa18.xlsx', 'Comparador SIAPE (resultado de la carga)', NULL),
  ('intranet_segunda_pasada_hospital', 'Segunda pasada Intranet MS (HOSPITAL)', 'Intranet MS', 33,
   NULL, 1, '', NULL, NULL, NULL, NULL, NULL, NULL, 'La lanza el comparador con el Excel de errores'),
  ('intranet_segunda_pasada_upa4', 'Segunda pasada Intranet MS (UPA 4)', 'Intranet MS', 34,
   NULL, 1, '', NULL, NULL, NULL, NULL, NULL, NULL, 'La lanza el comparador con el Excel de errores'),
  ('intranet_segunda_pasada_upa18', 'Segunda pasada Intranet MS (UPA 18)', 'Intranet MS', 35,
   NULL, 1, '', NULL, NULL, NULL, NULL, NULL, NULL, 'La lanza el comparador con el Excel de errores'),
  ('intranet_carga_ausentes', 'Carga de ausentes (28 - INASISTENCIA) en Intranet MS', 'Intranet MS', 36,
   'python cargar_ausentes_intranet.py --dependencia HOSPITAL', 0, '', NULL, NULL, NULL,
   'D:\\G\\comparacion', 'resultado_carga_ausentes.xlsx', NULL, NULL),
  ('intranet_carga_art26', 'Carga Art. 26 (FC) en Intranet MS', 'Intranet MS', 37,
   'python cargar_art26_intranet.py', 0, '', NULL, NULL, NULL,
   'D:\\G\\comparacion\\ART26', NULL, NULL, 'Lee art26_export.xlsx que genera la página Art. 26');
