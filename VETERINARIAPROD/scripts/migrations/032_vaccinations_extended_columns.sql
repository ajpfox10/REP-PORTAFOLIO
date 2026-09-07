-- Migration 032: Add extended columns to vaccinations table.
-- Uses information_schema + dynamic SQL for MySQL 8.0 compatibility.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'medical_record_id'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN medical_record_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'batch_number'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN batch_number VARCHAR(100) NULL COMMENT ''Numero de lote / batch''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'expiry_date'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN expiry_date DATE NULL COMMENT ''Vencimiento del lote''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'dose'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN dose VARCHAR(100) NULL COMMENT ''Dosis administrada''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'route'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN route VARCHAR(50) NULL COMMENT ''Via de administracion (SC, IM, IN, etc.)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'administration_site'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE vaccinations ADD COLUMN administration_site VARCHAR(100) NULL COMMENT ''Sitio de aplicacion''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vaccinations'
    AND CONSTRAINT_NAME = 'fk_vaccinations_medical_record'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE vaccinations ADD CONSTRAINT fk_vaccinations_medical_record FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
