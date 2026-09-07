-- Migration 035: Make inventory_items.branch_id nullable
-- The new multi-branch model stores stock per branch in inventory_stock
-- (item_id + branch_id unique). inventory_items is an org-level catalog
-- so branch_id is no longer required here.

ALTER TABLE inventory_items
  DROP FOREIGN KEY fk_inv_item_branch,
  MODIFY COLUMN branch_id INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Legacy — stock por sucursal ahora en inventory_stock';
