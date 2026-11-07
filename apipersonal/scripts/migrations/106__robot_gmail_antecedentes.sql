-- 106__robot_gmail_antecedentes.sql
-- Robot que baja por la API de Gmail los certificados de antecedentes penales
-- (nacionales y provinciales) que mandan los agentes a recepciondeantecedentesrrhhkm@gmail.com
-- y los deja en D:\G\DOCU\<dni>\Certificado ant. Nacionales|Provinciales. Sin tabla
-- propia: el estado es la etiqueta del mail (Robot/Procesado, Robot/Sin identificar).
-- Programado todos los días a las 04:00 (tarea \Robots\gmail_antecedentes).

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  ('gmail_antecedentes', 'Descarga de antecedentes penales del mail a DOCU', 'Gmail', 10,
   'python gmail_antecedentes_robot.py', 0, 1, '', NULL, '04:00', NULL,
   'D:\\G\\DOCU\\<dni>\\Certificado ant. Nacionales | Provinciales', 'Antecedentes Nacionales|Provinciales <fecha>.pdf', 'Trámites (carpeta DOCU)',
   'Casilla recepciondeantecedentesrrhhkm@gmail.com por API (token en scripts/gmail_antecedentes_token.json). DNI del certificado (texto u OCR) o por nombre; los no identificados van a D:\\G\\VARIOS\\ANTECEDENTES SIN IDENTIFICAR');
