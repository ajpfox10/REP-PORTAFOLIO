DROP TABLE IF EXISTS notification_logs_archive;
DROP TABLE IF EXISTS audit_log_immutable_archive;
ALTER TABLE notification_logs DROP COLUMN deleted_at;
ALTER TABLE reminders DROP COLUMN deleted_at;
ALTER TABLE api_keys DROP COLUMN deleted_at;
ALTER TABLE sessions DROP COLUMN deleted_at;
ALTER TABLE users DROP COLUMN deleted_at;
DROP TABLE IF EXISTS organization_auth_policies;
