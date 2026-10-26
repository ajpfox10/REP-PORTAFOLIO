-- 086: robots que suben como FC lo que el jefe carga a los no titulares (pedido 18/10/2026).
--   Ministerio: cargar_jefe_intranet_v2.py x3 dependencias (tabla jefe_carga_intranet, la crea el robot)
--   SIAPE:      cargar_jefe_siape.py                     (tabla jefe_carga_siape, la crea el robot)
--   Cadena:     circuito_jefe.py a las 06:00, primero Ministerio (Art. 26 + jefe) y despues SIAPE.

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_hora,
   destino_nombre, destino_editable, notas, activo)
VALUES
  ('circuito_jefe', 'Circuito jefe (FC): Ministerio y después SIAPE', 'Asistencia 2.0', 26,
   'python circuito_jefe.py', 0, 1, '', '06:00:00',
   'tablas jefe_carga_intranet / jefe_carga_siape', 0,
   'Corre en orden: Art. 26 a Intranet x3, examen/pre-examen/Pap-Colpo/prácticas a Intranet x3 (34 - FRANCO COMPENSATORIO) y al final todo eso a SIAPE como FRANCO COMPENSATORIO (COMUNICACIONES). Solo desde 01/09/2026.',
   1),
  ('intranet_carga_jefe_v2_hospital', 'Cargar lo del jefe (FC) · Hospital', 'Asistencia 2.0', 35,
   'python cargar_jefe_intranet_v2.py --dependencia "HOSPITAL"', 1, 0, '', NULL,
   'tabla jefe_carga_intranet', 0,
   'Examen, pre-examen, Pap/Colpo y prácticas de la página del jefe → Intranet como FC. No incluye Art. 26 (tiene su robot) ni permiso de salida (es por horas).',
   1),
  ('intranet_carga_jefe_v2_upa4', 'Cargar lo del jefe (FC) · UPA 4', 'Asistencia 2.0', 36,
   'python cargar_jefe_intranet_v2.py --dependencia "UPA 4"', 1, 0, '', NULL,
   'tabla jefe_carga_intranet', 0,
   'Examen, pre-examen, Pap/Colpo y prácticas de la página del jefe → Intranet como FC.',
   1),
  ('intranet_carga_jefe_v2_upa18', 'Cargar lo del jefe (FC) · UPA 18', 'Asistencia 2.0', 37,
   'python cargar_jefe_intranet_v2.py --dependencia "UPA 18"', 1, 0, '', NULL,
   'tabla jefe_carga_intranet', 0,
   'Examen, pre-examen, Pap/Colpo y prácticas de la página del jefe → Intranet como FC.',
   1),
  ('siape_carga_jefe', 'Carga de lo del jefe (FC) en SIAPE', 'SIAPE', 25,
   'python cargar_jefe_siape.py', 0, 0, '', NULL,
   'tabla jefe_carga_siape', 0,
   'Art. 26, examen, pre-examen, Pap/Colpo y prácticas → SIAPE como FRANCO COMPENSATORIO (COMUNICACIONES), un día por fila, solo días ya pasados. Si el día ya tiene otra novedad no la reemplaza (YA_EXISTIA).',
   1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), comando = VALUES(comando), notas = VALUES(notas);
