-- Migration 034: Add missing columns to inventory_items.
-- Uses information_schema + dynamic SQL so it can run through the JS runner.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'sku'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN sku VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'description'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN description TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'sale_price'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN sale_price DECIMAL(15,4) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'requires_prescription'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN requires_prescription TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'supplier_id'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN supplier_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'expiry_date'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN expiry_date DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'updated_at'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'deleted_at'
);
SET @sql = IF(@col_exists = 0, 'ALTER TABLE inventory_items ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = 'uq_inventory_items_sku'
);
SET @sql = IF(@idx_exists = 0, 'ALTER TABLE inventory_items ADD UNIQUE INDEX uq_inventory_items_sku (sku)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_items'
    AND CONSTRAINT_NAME = 'fk_inv_items_supplier'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inv_items_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
