CREATE TABLE IF NOT EXISTS event_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  topic VARCHAR(160) NOT NULL,
  payload_json JSON NOT NULL,
  meta_json JSON NULL,
  status ENUM('pending','processing','published','failed') NOT NULL DEFAULT 'pending',
  stream_id VARCHAR(80) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 10,
  next_attempt_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  last_error VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_outbox_status_next (status, next_attempt_at),
  KEY idx_event_outbox_topic_created (topic, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
