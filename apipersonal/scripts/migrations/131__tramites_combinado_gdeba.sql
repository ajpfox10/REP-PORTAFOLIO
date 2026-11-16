-- PDF combinados de "Tramite de nombramiento" (DOCU\<DNI>\Tramite de nombramiento\*.pdf)
-- y su envío a GDEBA como Informe Gráfico (IFGRA) enviado a firmar.
-- Una fila por archivo; la pestaña "Combinados" de Trámites lista los PDF del disco
-- y les cruza el estado de acá. Lo actualiza el robot gdeba_combinado_ifgra.py.
CREATE TABLE IF NOT EXISTS tramites_combinado_gdeba (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni INT NOT NULL,
  archivo VARCHAR(500) NOT NULL,
  estado ENUM('PENDIENTE','ENVIADA_FIRMA','FIRMADA','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  firmante VARCHAR(60) NULL,
  gdeba_numero VARCHAR(80) NULL,
  gdeba_error VARCHAR(500) NULL,
  enviada_at DATETIME NULL,
  estado_at DATETIME NULL,
  estado_por INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_comb_gdeba_archivo (archivo),
  KEY ix_comb_gdeba_dni (dni),
  KEY ix_comb_gdeba_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
   destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('gdeba_combinado_ifgra', 'Combinados de nombramiento → GDEBA (IFGRA a firmar)', 'GDEBA', 20,
   'python gdeba_combinado_ifgra.py', 1, 0, '',
   'GDEBA (GEDO) · IFGRA enviado a firmar', 'TRAMITE DE NOMBRAMIENTO <nombre>', 0,
   'Trámites (pestaña Combinados)',
   'Sube el PDF combinado como Informe Gráfico (IFGRA), repartición DPTRH, y lo envía a firmar al usuario elegido en la pestaña. Modo prueba: 1 archivo, frena antes de Aceptar. Capturas en scripts/logs/gdeba.', 1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), grupo = VALUES(grupo), comando = VALUES(comando),
  reporta_solo = VALUES(reporta_solo), notas = VALUES(notas), lo_leen = VALUES(lo_leen), activo = 1;
