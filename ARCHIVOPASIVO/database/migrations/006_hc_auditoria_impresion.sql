USE `archivo_pasivo`;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND COLUMN_NAME = 'cargado_por'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE historias_clinicas ADD COLUMN cargado_por INT NULL AFTER comentarios', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND COLUMN_NAME = 'caja'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE historias_clinicas ADD COLUMN caja VARCHAR(80) NULL AFTER fecha_ultimo_movimiento', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND COLUMN_NAME = 'etiqueta_impresa'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE historias_clinicas ADD COLUMN etiqueta_impresa TINYINT(1) NOT NULL DEFAULT 0 AFTER cargado_por', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND COLUMN_NAME = 'fecha_impresion'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE historias_clinicas ADD COLUMN fecha_impresion DATETIME NULL AFTER etiqueta_impresa', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND COLUMN_NAME = 'impreso_por'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE historias_clinicas ADD COLUMN impreso_por INT NULL AFTER fecha_impresion', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS historias_clinicas_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  historia_clinica_id BIGINT NOT NULL,
  pedido_id BIGINT NULL,
  usuario_id INT NULL,
  accion VARCHAR(40) NOT NULL,
  campo VARCHAR(80) NOT NULL,
  valor_anterior TEXT NULL,
  valor_nuevo TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hc_auditoria_hc (historia_clinica_id),
  INDEX idx_hc_auditoria_pedido (pedido_id),
  INDEX idx_hc_auditoria_usuario (usuario_id),
  INDEX idx_hc_auditoria_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'historias_clinicas'
    AND INDEX_NAME = 'idx_hc_etiqueta_impresa'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_hc_etiqueta_impresa ON historias_clinicas (etiqueta_impresa)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
