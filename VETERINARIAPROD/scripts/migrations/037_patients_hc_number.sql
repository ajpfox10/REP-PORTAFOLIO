-- Migration 037: stable HC number on patients

SET @hc_col_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'patients'
     AND COLUMN_NAME = 'hc_number'
);
SET @hc_col_sql := IF(
  @hc_col_exists = 0,
  'ALTER TABLE patients ADD COLUMN hc_number VARCHAR(32) NULL AFTER name',
  'SELECT 1'
);
PREPARE stmt_hc_col FROM @hc_col_sql;
EXECUTE stmt_hc_col;
DEALLOCATE PREPARE stmt_hc_col;

UPDATE patients
   SET hc_number = CONCAT('HC', LPAD(id, 6, '0'))
 WHERE hc_number IS NULL OR hc_number = '';

ALTER TABLE patients
  MODIFY COLUMN hc_number VARCHAR(32) NOT NULL;

SET @uq_hc_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'patients'
     AND INDEX_NAME = 'uq_patients_hc_number'
);
SET @uq_hc_sql := IF(
  @uq_hc_exists = 0,
  'ALTER TABLE patients ADD UNIQUE KEY uq_patients_hc_number (hc_number)',
  'SELECT 1'
);
PREPARE stmt_uq_hc FROM @uq_hc_sql;
EXECUTE stmt_uq_hc;
DEALLOCATE PREPARE stmt_uq_hc;
