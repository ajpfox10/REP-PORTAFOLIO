-- 108: robot "Ausentes" (04/11/2026). Los AUSENTE SIN AVISO se desacoplan del Circuito 2.0 y se
-- cargan al final de todo (circuito_ausentes.py: espera al Circuito 2.0 y al Circuito jefe y
-- corre intranet_carga_ausentes_v2_hospital / _upa4 / _upa18). Sin programar: la hora se pone
-- desde la pagina Robots. No reactiva los robots de ausentes (suspendidos el 03/11/2026).
INSERT INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa,
                           prog_dias, destino_nombre, destino_editable, notas, activo)
SELECT 'circuito_ausentes', 'Ausentes', 'Asistencia 2.0', 27, 'python circuito_ausentes.py', 0, 0,
       '', 'tabla novedades_carga_intranet', 0,
       'Carga al final de todo los AUSENTE SIN AVISO (28 - INASISTENCIA) en la Intranet: espera a que terminen el Circuito 2.0 y el Circuito jefe y corre ausentes Hospital, UPA 4 y UPA 18. Si los robots de ausentes estan suspendidos (inactivos) no carga nada.',
       1
 WHERE NOT EXISTS (SELECT 1 FROM robots_config WHERE script = 'circuito_ausentes');
