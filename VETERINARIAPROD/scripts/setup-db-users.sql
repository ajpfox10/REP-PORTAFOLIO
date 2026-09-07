-- ============================================================
-- setup-db-users.sql
-- Principio de Mínimo Privilegio — usuarios MySQL restringidos
-- ============================================================
--
-- Ejecutar como root de MySQL UNA sola vez durante el setup del servidor.
-- Reemplazar los passwords por valores seguros (mínimo 24 chars aleatorios).
--
-- Usuarios creados:
--   vetapp          — aplicación principal (DML: SELECT/INSERT/UPDATE/DELETE)
--   vetapp_migrate  — migraciones (DDL: CREATE/ALTER/DROP)
--   vetapp_ro       — reportes y analytics de solo lectura (SELECT)
--   vetapp_backup   — backup con mysqldump (LOCK TABLES + SELECT)
--
-- En producción, los passwords deben venir de un secret manager
-- (AWS Secrets Manager, HashiCorp Vault, etc.) y rotarse cada 90 días.
-- ============================================================

-- ── Eliminar usuarios existentes (idempotente) ────────────────────────────────
DROP USER IF EXISTS 'vetapp'@'%';
DROP USER IF EXISTS 'vetapp_migrate'@'%';
DROP USER IF EXISTS 'vetapp_ro'@'%';
DROP USER IF EXISTS 'vetapp_backup'@'localhost';

-- ── Usuario principal de la aplicación ───────────────────────────────────────
-- Solo DML. No puede hacer DROP/ALTER/CREATE ni acceder a information_schema.
CREATE USER 'vetapp'@'%' IDENTIFIED BY 'CHANGE_ME_APP_PASSWORD_MIN_24_CHARS';

GRANT SELECT, INSERT, UPDATE, DELETE ON vetmanager.* TO 'vetapp'@'%';

-- Procedimientos almacenados propios (llamada con CALL sp_*)
GRANT EXECUTE ON vetmanager.* TO 'vetapp'@'%';

-- ── Usuario de migraciones ────────────────────────────────────────────────────
-- Usado SOLO por scripts de migración. No debe estar en producción permanente.
CREATE USER 'vetapp_migrate'@'localhost' IDENTIFIED BY 'CHANGE_ME_MIGRATE_PASSWORD_MIN_24_CHARS';

GRANT SELECT, INSERT, UPDATE, DELETE ON vetmanager.* TO 'vetapp_migrate'@'localhost';
GRANT CREATE, ALTER, DROP, INDEX, REFERENCES ON vetmanager.* TO 'vetapp_migrate'@'localhost';
GRANT CREATE ROUTINE, ALTER ROUTINE ON vetmanager.* TO 'vetapp_migrate'@'localhost';

-- ── Usuario de solo lectura (reportes / BI / exports) ────────────────────────
CREATE USER 'vetapp_ro'@'%' IDENTIFIED BY 'CHANGE_ME_READONLY_PASSWORD_MIN_24_CHARS';

GRANT SELECT ON vetmanager.* TO 'vetapp_ro'@'%';

-- ── Usuario de backup ─────────────────────────────────────────────────────────
-- Solo desde localhost para mysqldump. No puede modificar datos.
CREATE USER 'vetapp_backup'@'localhost' IDENTIFIED BY 'CHANGE_ME_BACKUP_PASSWORD_MIN_24_CHARS';

GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON vetmanager.* TO 'vetapp_backup'@'localhost';
-- Para mysqldump con --single-transaction no necesita LOCK TABLES, pero lo incluimos por compatibilidad.

-- ── Revocar privilegios innecesarios del sistema ──────────────────────────────
-- (Asegurarse de que ningún usuario tenga acceso a mysql.user)
REVOKE ALL PRIVILEGES ON mysql.* FROM 'vetapp'@'%';

-- ── Aplicar cambios ───────────────────────────────────────────────────────────
FLUSH PRIVILEGES;

-- ── Verificar (opcional, descomentar para revisar) ────────────────────────────
-- SHOW GRANTS FOR 'vetapp'@'%';
-- SHOW GRANTS FOR 'vetapp_migrate'@'localhost';
-- SHOW GRANTS FOR 'vetapp_ro'@'%';
-- SHOW GRANTS FOR 'vetapp_backup'@'localhost';
