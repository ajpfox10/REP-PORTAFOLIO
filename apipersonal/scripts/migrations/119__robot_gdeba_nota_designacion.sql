-- Robot que carga en GDEBA (GEDO) las notas de designación de una tanda y las envía a firmar.
-- Se dispara desde Trámites → tanda → 🏛️ Nota GDEBA (pedido en app_runtime_config
-- 'gdeba_nota_designacion_pedido'). Sin programación: necesita login manual (captcha).
INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('gdeba_nota_designacion', 'Notas de designación → GDEBA (enviar a firmar)', 'GDEBA', 10,
   'python gdeba_nota_designacion.py', 1, 0, '',
   'GDEBA (GEDO) · IF enviado a firmar', 'DESIGNACION PLANTA PERMANENTE <nombre>', 0,
   'Trámites (Nota GDEBA)',
   'Login manual (captcha). Repartición DPTRH, tipo IF, firmante Valeria Silvina Fernandez Viña. Modo prueba: 1 nota sin enviar. Capturas en scripts/logs/gdeba.', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), notas = VALUES(notas), activo = 1;
