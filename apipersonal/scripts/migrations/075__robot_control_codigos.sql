-- 075__robot_control_codigos.sql
-- Robot que lee el combo de novedades de la Intranet MS, mantiene ministerio_codigos
-- (mig 074) y controla el mapeo. Se programa desde la página Robots (prog_activa = 0:
-- la tarea de Windows la crea la página al activarlo).

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_nombre, destino_editable, notas, activo)
VALUES
  ('intranet_control_codigos', 'Control del combo de novedades de la Intranet vs mapeo', 'Asistencia 2.0', 40,
   'python intranet_control_codigos.py', 1, 0, 'LU',
   'tabla ministerio_codigos', 0,
   'Solo LEE el combo "Novedad" de un agente del plantel (no carga nada). Da de alta los códigos nuevos, marca los que desaparecieron y avisa si una regla de carga apunta a un texto que no está en el combo. Error = hay algo que mapear/corregir en Asistencia → Mapeo.',
   1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), comando = VALUES(comando), notas = VALUES(notas);
