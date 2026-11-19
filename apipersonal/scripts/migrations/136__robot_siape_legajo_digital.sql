-- 136__robot_siape_legajo_digital.sql
-- Robot que baja de SIAPE (Personas -> Administración -> pestaña LEGAJO DIGITAL, tipo de trámite
-- "PASE A PLANTA PERMANENTE 2026") el CURRICULUM VITAE y la PLANILLA DE DATOS PERSONALES Y DE
-- CONTACTOS (la de fecha más nueva) de los agentes de una tanda de Trámites y los deja en
-- D:\G\DOCU\<dni>\Curriculum y D:\G\DOCU\<dni>\Planilla de datos personales.
-- Sin programación: lo lanza el botón "⬇️ Legajo SIAPE" de Trámites, que deja la tanda en
-- app_runtime_config 'siape_legajo_digital_pedido' (run_robot no pasa parámetros).
-- Sin tabla propia: el estado es la carpeta (si ya tiene el archivo de esa fecha, no lo baja).

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  ('siape_legajo_digital', 'Legajo Digital SIAPE → CV y Planilla de datos personales a DOCU', 'SIAPE', 26,
   'python descargar_legajo_digital_siape.py', 0, '', NULL, NULL, NULL,
   'D:\\G\\DOCU\\<dni>\\Curriculum | Planilla de datos personales', 'Curriculum SIAPE <dd-mm-aaaa>.pdf / Planilla de datos personales SIAPE <dd-mm-aaaa>.pdf',
   'Trámites (⬇️ Legajo SIAPE, 📦 Pase a planta)',
   'Lo lanza el botón de Trámites (tanda en app_runtime_config siape_legajo_digital_pedido). Solo PASE A PLANTA PERMANENTE 2026: quien no lo tiene no está en la tanda 2026 de SIAPE. Verifica el DNI dentro del PDF. ~6 min por agente.');
