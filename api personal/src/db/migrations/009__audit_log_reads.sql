-- Índices para consultas de lectura
ALTER TABLE `audit_log` ADD INDEX `idx_audit_log_reads` (`action`, `table_name`, `created_at`);