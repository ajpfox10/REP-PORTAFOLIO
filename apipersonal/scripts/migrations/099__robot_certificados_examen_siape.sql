-- 099__robot_certificados_examen_siape.sql
-- Robot que baja de SIAPE (Rec. Médicos -> Examenes Medicos -> Certificado) el
-- certificado de aptitud psicofísica del examen de ingreso de los agentes de las
-- tandas de nombramiento (tramites_tanda_interinos) y lo deja en
-- D:\G\DOCU\<dni>\Certificado Apto Psicofisico. Sin tabla propia: el estado es
-- la carpeta (si ya tiene archivo, no lo vuelve a bajar).

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  ('siape_certificados_examen', 'Descarga de certificados de apto psicofísico (examen de ingreso) a DOCU', 'SIAPE', 25,
   'python descargar_certificados_examen_siape.py', 0, '', NULL, NULL, NULL,
   'D:\\G\\DOCU\\<dni>\\Certificado Apto Psicofisico', 'Apto Psicofisico SIAPE <CODIGO>.pdf', 'Trámites (carpeta DOCU)',
   'Agentes de tramites_tanda_interinos; elige EXAMEN DE INGRESO con resultado APTO; verifica el DNI dentro del PDF; saltea si la subcarpeta ya tiene archivo');
