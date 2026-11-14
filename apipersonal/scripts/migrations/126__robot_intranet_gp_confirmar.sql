-- 126: robot que confirma los usuarios pendientes de Gestiones Personales (Intranet MS)
-- (scripts/confirmar_usuarios_gp.py --confirmar). Usa el mismo perfil de Chrome que los robots de
-- carga de la Intranet → grupo "Intranet MS" + prefijo intranet_ → recurso robots_intranet en
-- run_robot.py: espera su turno y nunca corre a la vez que otro robot de la Intranet.
-- La tarea \Robots\intranet_gp_confirmar (cada 30 min) se crea a mano: la página Robots solo sabe diario/semanal.
INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('intranet_gp_confirmar', 'Gestiones Personales: confirmar usuarios pendientes (clave provisoria = DNI)', 'Intranet MS', 90,
   'python confirmar_usuarios_gp.py --confirmar', 0, 1, '',
   NULL, NULL, 0,
   'Intranet → Administrador de Gestiones Personales',
   'Corre CADA 30 MINUTOS (trigger puesto a mano). Si se guarda la programación desde esta página vuelve a diario: rehacer el trigger de 30 min. Entra con la sesión guardada en el perfil de Chrome de la Intranet, confirma los "A CONFIRMAR" (elige la cuenta por CUIL) y verifica que queden con clave provisoria. Log por corrida en logs/confirmar_usuarios_gp/.', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), destino_dir = VALUES(destino_dir), destino_nombre = VALUES(destino_nombre),
  lo_leen = VALUES(lo_leen), notas = VALUES(notas), activo = 1;
