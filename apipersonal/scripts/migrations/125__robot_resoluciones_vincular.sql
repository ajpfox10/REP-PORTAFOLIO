-- 125: robot diario que registra en tblarchivos (dni=1) los PDF nuevos de RESOLUCIONES Y VARIOS
-- y vincula resoluciones.archivo_id de las que tengan un solo candidato
-- (scripts/resoluciones_registrar_y_vincular.cjs). Grupo "Archivos" → no espera a SiAPe.
-- La tarea \Robots\resoluciones_vincular se crea al guardar la programación en la página Robots.
INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_hora,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('resoluciones_vincular', 'Resoluciones ↔ PDF de RESOLUCIONES Y VARIOS (registrar + vincular)', 'Archivos', 20,
   'node resoluciones_registrar_y_vincular.cjs --apply', 0, 1, '', '21:00:00',
   'D:\\G\\RESOLUCIONES Y VARIOS', '<número de la resolución>.pdf', 0,
   'Resoluciones (aviso de resoluciones sin archivo)',
   'Registra los PDF que se copien a mano a la carpeta y vincula las resoluciones cargadas sin escaneo. Lo mismo que el botón ↻ Buscar de nuevo del aviso. Empates y faltantes quedan en el aviso.', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), destino_dir = VALUES(destino_dir), destino_nombre = VALUES(destino_nombre),
  lo_leen = VALUES(lo_leen), notas = VALUES(notas), activo = 1;
