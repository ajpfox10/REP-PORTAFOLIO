-- Robot que mantiene la carpeta de Pase a planta al día con DOCU (scripts/pase_planta.py), cada 2 min.
-- Copia todos los documentos del orden del trámite en JPG, reemplaza si en DOCU hay uno más nuevo
-- (lo anterior va a la subcarpeta "viejos") y pasa a JPG lo que no lo esté. Grupo "Archivos" →
-- recurso propio en run_robot.py (no espera a los robots de SiAPe).
-- La tarea \Robots\pase_planta (cada 2 min) se crea a mano: la página Robots solo sabe diario/semanal.
INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('pase_planta', 'DOCU → carpeta de Pase a planta (todo en JPG)', 'Archivos', 10,
   'python pase_planta.py', 0, 1, '',
   'D:\\Pase a planta\\PASE A PLANTA PERMANENTE 2026', '<HTAL|UPA 18|UPA 4>\\<APELLIDO NOMBRE>\\<DOCUMENTO>.jpg', 0,
   'Trámites (📦 Pase a planta)',
   'Corre CADA 2 MINUTOS (trigger puesto a mano). Si se guarda la programación desde esta página vuelve a diario: rehacer el trigger de 2 min. Solo registra las corridas en que cambió algo o cambiaron los errores.', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), destino_dir = VALUES(destino_dir), destino_nombre = VALUES(destino_nombre),
  lo_leen = VALUES(lo_leen), notas = VALUES(notas), activo = 1;
