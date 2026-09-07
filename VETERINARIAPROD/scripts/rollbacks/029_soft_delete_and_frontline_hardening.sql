DROP TABLE IF EXISTS security_alerts_archive;
DROP TABLE IF EXISTS message_logs_archive;

ALTER TABLE payments DROP COLUMN deleted_at;
ALTER TABLE invoices DROP COLUMN deleted_at;
ALTER TABLE appointments DROP COLUMN deleted_at;
ALTER TABLE client_emergency_contacts DROP COLUMN deleted_at;
ALTER TABLE patient_owners DROP COLUMN deleted_at;
ALTER TABLE patients DROP COLUMN deleted_at;
ALTER TABLE clients DROP COLUMN deleted_at;
