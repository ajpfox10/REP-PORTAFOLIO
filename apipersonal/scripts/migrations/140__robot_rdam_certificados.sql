-- Robot que baja el certificado de libre deuda alimentaria (RDAM) de los agentes de las tandas
-- (scripts/descargar_rdam.py, SCRIPT_ID rdam_certificados). Guarda en DOCU\<dni>\Libre de deuda (RDAM)
-- y lo anterior de esa carpeta pasa a Trasladados; saltea a quien ya tiene uno vigente (< 60 días).
-- Grupo "RDAM" → recurso propio en run_robot.py (sitio público, Chromium headless: no espera a SiAPe
-- ni a la Intranet). Lunes a viernes 07:00 (después de circuito_jefe 06:00, antes de las 08:00).
INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_hora,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('rdam_certificados', 'Certificado de libre deuda alimentaria (RDAM) de las tandas a DOCU', 'RDAM', 10,
   'python descargar_rdam.py', 0, 1, 'LU,MA,MI,JU,VI', '07:00:00',
   'D:\\G\\DOCU\\<dni>\\Libre de deuda (RDAM)', 'APELLIDO NOMBRE RDAM aaaa-mm-dd.pdf', 0,
   'Trámites (⚖️ RDAM) · Pase a planta',
   'Solo pide a quien no tiene un certificado vigente (< 60 días); lo viejo de la carpeta va a Trasladados (nunca se borra).', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), prog_activa = VALUES(prog_activa), prog_dias = VALUES(prog_dias),
  prog_hora = VALUES(prog_hora), destino_dir = VALUES(destino_dir), destino_nombre = VALUES(destino_nombre),
  lo_leen = VALUES(lo_leen), notas = VALUES(notas), activo = 1;
