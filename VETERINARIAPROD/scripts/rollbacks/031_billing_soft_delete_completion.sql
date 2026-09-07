ALTER TABLE stock_alerts DROP COLUMN deleted_at;
ALTER TABLE purchase_order_items DROP COLUMN deleted_at;
ALTER TABLE purchase_orders DROP COLUMN deleted_at;
ALTER TABLE inventory_batches DROP COLUMN deleted_at;
ALTER TABLE inventory_items DROP COLUMN deleted_at;
ALTER TABLE suppliers DROP COLUMN deleted_at;
