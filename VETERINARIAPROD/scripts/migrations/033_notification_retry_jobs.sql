-- Migration 033: Create notification_retry_jobs table
-- This table is used by shared/notificationRetry.js to queue and retry
-- failed notification deliveries (email, SMS, WhatsApp, push) with
-- exponential back-off.

CREATE TABLE IF NOT EXISTS notification_retry_jobs (
  id               INT          NOT NULL AUTO_INCREMENT,
  channel          VARCHAR(50)  NOT NULL COMMENT 'email | sms | whatsapp | template | push_topic | push_tokens',
  payload_json     LONGTEXT     NOT NULL COMMENT 'JSON-encoded notification payload',
  status           ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  attempt_count    INT          NOT NULL DEFAULT 0,
  max_attempts     INT          NOT NULL DEFAULT 5,
  next_attempt_at  DATETIME     NULL     COMMENT 'NULL when permanently failed or delivered',
  last_attempt_at  DATETIME     NULL,
  last_error       VARCHAR(512) NULL,
  created_by       INT          NULL     COMMENT 'user_id that triggered the notification',
  org_id           INT          NULL,
  branch_id        INT          NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NULL     ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_nrj_status_next (status, next_attempt_at),
  INDEX idx_nrj_org         (org_id),
  INDEX idx_nrj_branch      (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
