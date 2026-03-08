-- Platform extras: sessions, recovery, outbox, inventory, sales, appointments
CREATE TABLE IF NOT EXISTS auth_recovery_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id VARCHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  UNIQUE KEY uq_user_code (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS auth_trusted_devices (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  device_label VARCHAR(128) NULL,
  device_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  UNIQUE KEY uq_user_device (user_id, device_fingerprint)
);

CREATE TABLE IF NOT EXISTS agenda_appointments (
  id VARCHAR(64) PRIMARY KEY,
  resource_type VARCHAR(16) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  status VARCHAR(16) NOT NULL DEFAULT 'booked',
  patient_id VARCHAR(64) NULL,
  pet_id VARCHAR(64) NULL,
  notes VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  UNIQUE KEY uq_slot (resource_type, resource_id, date, start_time)
);

CREATE TABLE IF NOT EXISTS clinical_records (
  id VARCHAR(64) PRIMARY KEY,
  visit_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(200) NULL,
  body TEXT NOT NULL,
  attachments_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  INDEX idx_visit (visit_id)
);

CREATE TABLE IF NOT EXISTS inv_products (
  id VARCHAR(64) PRIMARY KEY,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  price_cents INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  UNIQUE KEY uq_sku (sku)
);

CREATE TABLE IF NOT EXISTS inv_stock_moves (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  qty_delta INT NOT NULL,
  reason VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  INDEX idx_prod (product_id)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id VARCHAR(64) PRIMARY KEY,
  customer_name VARCHAR(200) NULL,
  total_cents INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'paid',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  qty INT NOT NULL,
  unit_price_cents INT NOT NULL,
  INDEX idx_order (order_id)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(64) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_run_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  idem_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  status_code INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (idem_key)
);
