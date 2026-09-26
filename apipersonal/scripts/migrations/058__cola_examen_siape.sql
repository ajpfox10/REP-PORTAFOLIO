-- 058__cola_examen_siape.sql
-- Cola del robot que carga en SIAPE el EXAMEN que falta después de un PRE-EXAMEN
-- (art. 59 Dec. 4161/96: el examen es el día siguiente al último día de
-- pre-examen, caiga donde caiga). La llena el propio robot leyendo
-- D:\G\comparacion\SIAPE\SIAPE.xlsx con la misma regla del comparador.
-- estado: pendiente | cargado | ya_estaba | error

CREATE TABLE IF NOT EXISTS cola_examen_siape (
  dni VARCHAR(20) NOT NULL,
  fecha DATE NOT NULL,
  apellido VARCHAR(120) NULL,
  nombre VARCHAR(120) NULL,
  pre_desde DATE NULL,
  pre_hasta DATE NULL,
  estado ENUM('pendiente','cargado','ya_estaba','error') NOT NULL DEFAULT 'pendiente',
  motivo VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0,
  creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dni, fecha),
  KEY idx_cola_examen__estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  ('siape_carga_examen', 'Carga de EXAMEN automático tras pre-examen en SIAPE', 'SIAPE', 24,
   'python cargar_examen_siape.py', 0, '', NULL, NULL, NULL, NULL, NULL, NULL,
   'Lee SIAPE\\SIAPE.xlsx; EXAMEN el día siguiente al pre-examen, sin tildar JUSTIFICADO; no duplica (lee la grilla antes)');
