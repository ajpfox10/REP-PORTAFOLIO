-- 064 — Carga a la Intranet MS: todo pasa a la versión 2.0 (tablas)
-- * Art. 26 2.0: tabla art26_carga_intranet (FK a articulo_26) + 3 robots por dependencia.
--   La tabla también se crea sola en runtime (cargar_art26_intranet_v2.py / articulo26Intranet.routes.ts).
-- * Circuito 2.0: ahora incluye descargas + freno + carga de Art. 26 (circuito_v2.py).
-- * Robots viejos (Excel) quedan SIN USO: activo = 0 (no se borran).
-- Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE + UPDATE.

CREATE TABLE IF NOT EXISTS art26_carga_intranet (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  art26_id BIGINT UNSIGNED NOT NULL,
  dni VARCHAR(12) NOT NULL,
  nombre VARCHAR(160) NOT NULL DEFAULT '',
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  estado_art26 VARCHAR(20) NOT NULL DEFAULT '',
  dependencia_sugerida VARCHAR(20) NOT NULL DEFAULT 'HOSPITAL',
  deps_descartadas VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'dependencias donde la Intranet dijo "no pertenece" (CSV)',
  dependencia VARCHAR(20) NULL COMMENT 'dependencia del ultimo intento',
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / ERROR / ERROR_NAV / EXCEPCION / BAJA',
  label_intranet VARCHAR(200) NULL,
  detalle VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0,
  cargado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_art26_carga_intranet__art26 (art26_id),
  KEY idx_art26_carga_intranet__estado (estado, dependencia_sugerida),
  CONSTRAINT fk_art26_carga_intranet__art26 FOREIGN KEY (art26_id)
    REFERENCES articulo_26 (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, destino_nombre, destino_editable, notas, activo)
VALUES
  ('intranet_carga_art26_v2_hospital', 'Cargar Art. 26 (FC) · Hospital', 'Asistencia 2.0', 32,
   'python cargar_art26_intranet_v2.py --dependencia "HOSPITAL"', 1, 0, '', 'tabla art26_carga_intranet', 0,
   'Carga como FC / FRANCO COMPENSATORIO los Art. 26 (sin anulados ni rechazados) de la base. Resultado en art26_carga_intranet; los OK no se reintentan. Procesa los de su dependencia y los que otra dependencia descartó por "no pertenece".', 1),
  ('intranet_carga_art26_v2_upa4', 'Cargar Art. 26 (FC) · UPA 4', 'Asistencia 2.0', 33,
   'python cargar_art26_intranet_v2.py --dependencia "UPA 4"', 1, 0, '', 'tabla art26_carga_intranet', 0,
   'Igual que el de Hospital, para UPA 4.', 1),
  ('intranet_carga_art26_v2_upa18', 'Cargar Art. 26 (FC) · UPA 18', 'Asistencia 2.0', 34,
   'python cargar_art26_intranet_v2.py --dependencia "UPA 18"', 1, 0, '', 'tabla art26_carga_intranet', 0,
   'Igual que el de Hospital, para UPA 18.', 1);

UPDATE robots_config
   SET descripcion = 'Circuito completo: bajar + comparar + cargar novedades, ausentes y Art. 26',
       notas = 'Corre en orden: descargas (SIAPE Novedades Por Periodo + Ministerio Hospital/UPA 4/UPA 18) → FRENO (si una descarga falla o su archivo no se actualizó, no compara ni carga) → Comparador 2.0 → novedades 2.0 x3 → ausentes 2.0 x3 → Art. 26 2.0 x3 → Horario Administrativo (no frena). Al programarlo, desactivar las tareas sueltas de las descargas.'
 WHERE script = 'circuito_v2';

UPDATE robots_config
   SET notas = REPLACE(notas, ' Los botones rojos del comparador (versión vieja) siguen igual.', ' Lo lanzan también los botones del Comparador SIAPE.')
 WHERE script LIKE 'intranet_carga_%_v2_%';

UPDATE robots_config
   SET activo = 0,
       notas = CONCAT('SIN USO desde la 2.0 (04/10/2026). ', COALESCE(notas, ''))
 WHERE script IN ('intranet_carga_art26', 'intranet_carga_ausentes',
                  'intranet_carga_novedades_hospital', 'intranet_carga_novedades_upa4', 'intranet_carga_novedades_upa18')
   AND activo = 1;
