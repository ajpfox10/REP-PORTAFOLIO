-- 057__script_run_items.sql
-- Detalle por agente/novedad de cada corrida de robot (página Robots: ver qué
-- se cargó y qué falló, con el motivo).
--
-- script_runs.run_uid: identificador de la corrida. Los ítems se escriben
-- DURANTE la corrida con ese uid (si el robot se cae, lo ya hecho queda) y la
-- fila de script_runs se escribe al final con el mismo uid. run_robot.py lo
-- pasa a los robots en la variable ROBOT_RUN_UID.
-- estado: ok | error | aviso (salteado, ya estaba, pendiente, etc.)

SET @existe := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'script_runs' AND column_name = 'run_uid');
SET @sql := IF(@existe = 0,
  'ALTER TABLE script_runs ADD COLUMN run_uid VARCHAR(32) NULL AFTER script, ADD KEY idx_script_runs__uid (run_uid)',
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS script_run_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_uid VARCHAR(32) NOT NULL,
  script VARCHAR(120) NOT NULL,
  dni VARCHAR(20) NULL,
  nombre VARCHAR(200) NULL,
  novedad VARCHAR(200) NULL,
  desde VARCHAR(20) NULL,
  hasta VARCHAR(20) NULL,
  estado ENUM('ok','error','aviso') NOT NULL,
  detalle VARCHAR(1000) NULL,
  creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_items__run (run_uid, estado),
  KEY idx_items__script_fecha (script, creado_at),
  KEY idx_items__dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
