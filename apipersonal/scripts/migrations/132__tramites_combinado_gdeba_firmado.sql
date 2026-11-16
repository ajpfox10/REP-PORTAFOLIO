-- Combinados → GDEBA: el robot gdeba_combinado_firmados.py baja el IFGRA firmado de
-- GEDO (Mis Tareas → Avisos, motivo FIRMADO) y lo guarda junto al combinado como
-- "<combinado> - FIRMADO <IF-...>.pdf". Acá queda su ruta (relativa a DOCU) y cuándo se firmó.
-- Idempotente (el ensure del router agrega las columnas si faltan).
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tramites_combinado_gdeba' AND COLUMN_NAME = 'archivo_firmado');
SET @s1 := IF(@c1 = 0, 'ALTER TABLE tramites_combinado_gdeba ADD COLUMN archivo_firmado VARCHAR(500) NULL AFTER gdeba_numero', 'SELECT 1');
PREPARE st1 FROM @s1; EXECUTE st1; DEALLOCATE PREPARE st1;

SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tramites_combinado_gdeba' AND COLUMN_NAME = 'firmada_at');
SET @s2 := IF(@c2 = 0, 'ALTER TABLE tramites_combinado_gdeba ADD COLUMN firmada_at DATETIME NULL AFTER enviada_at', 'SELECT 1');
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('gdeba_combinado_firmados', 'Combinados de nombramiento ← GDEBA (bajar firmados)', 'GDEBA', 21,
   'python gdeba_combinado_firmados.py', 1, 0, '',
   'DOCU\\<DNI>\\Tramite de nombramiento', '<combinado> - FIRMADO <IF-...>.pdf', 0,
   'Trámites (pestaña Combinados)',
   'Busca en GEDO → Mis Tareas → Avisos (motivo FIRMADO) la referencia TRAMITE DE NOMBRAMIENTO <nombre> de cada combinado enviado a firmar, baja el PDF firmado y marca FIRMADA con el número GDEBA. RECHAZADO → Error. Sin firmar todavía → queda igual (no es error).', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), notas = VALUES(notas), lo_leen = VALUES(lo_leen),
  destino_dir = VALUES(destino_dir), destino_nombre = VALUES(destino_nombre), activo = 1;
