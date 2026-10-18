-- ============================================================================
-- Migration 047: modelo SaaS — suscripciones, prueba gratuita y roles base
--
-- `tenants` es la suscripción de cada organización (una fila por org). Se le
-- agregan los campos de la prueba gratuita y de MercadoPago (preapproval).
-- Todas las sentencias son condicionales: sirve para MySQL 8 y MariaDB, y es
-- segura sobre bases que ya tengan parte de estas columnas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id                 INT UNSIGNED NOT NULL,
  plan                   VARCHAR(64)  NULL,
  status                 VARCHAR(64)  NULL,
  subdomain              VARCHAR(64)  NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS migrate_047_add_column;
CREATE PROCEDURE migrate_047_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @migrate_047_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE migrate_047_stmt FROM @migrate_047_sql;
    EXECUTE migrate_047_stmt;
    DEALLOCATE PREPARE migrate_047_stmt;
  END IF;
END;

DROP PROCEDURE IF EXISTS migrate_047_add_index;
CREATE PROCEDURE migrate_047_add_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_definition VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @migrate_047_sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
    PREPARE migrate_047_stmt FROM @migrate_047_sql;
    EXECUTE migrate_047_stmt;
    DEALLOCATE PREPARE migrate_047_stmt;
  END IF;
END;

-- Suscripción
CALL migrate_047_add_column('tenants', 'trial_ends_at',          'DATETIME NULL');
CALL migrate_047_add_column('tenants', 'current_period_end',     'DATETIME NULL');
CALL migrate_047_add_column('tenants', 'billing_email',          'VARCHAR(255) NULL');
CALL migrate_047_add_column('tenants', 'next_billing_date',      'DATE NULL');
CALL migrate_047_add_column('tenants', 'stripe_customer_id',     'VARCHAR(64) NULL');
CALL migrate_047_add_column('tenants', 'stripe_subscription_id', 'VARCHAR(64) NULL');
CALL migrate_047_add_column('tenants', 'stripe_price_id',        'VARCHAR(64) NULL');
CALL migrate_047_add_column('tenants', 'payment_provider',       'VARCHAR(32) NULL');
CALL migrate_047_add_column('tenants', 'mp_preapproval_id',      'VARCHAR(64) NULL');
CALL migrate_047_add_column('tenants', 'pending_plan',           'VARCHAR(32) NULL');
CALL migrate_047_add_column('tenants', 'cancelled_at',           'DATETIME NULL');
CALL migrate_047_add_column('tenants', 'updated_at',             'DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
CALL migrate_047_add_index('tenants', 'uq_tenants_org_id',            'UNIQUE INDEX uq_tenants_org_id (org_id)');
CALL migrate_047_add_index('tenants', 'uq_tenants_subdomain',         'UNIQUE INDEX uq_tenants_subdomain (subdomain)');
CALL migrate_047_add_index('tenants', 'idx_tenants_mp_preapproval_id', 'INDEX idx_tenants_mp_preapproval_id (mp_preapproval_id)');

-- Historial de eventos de facturación (Stripe y MercadoPago)
CREATE TABLE IF NOT EXISTS subscription_events (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id          INT UNSIGNED NULL,
  event_type      VARCHAR(64)  NOT NULL,
  stripe_event_id VARCHAR(191) NULL,
  payload         JSON         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL migrate_047_add_column('subscription_events', 'provider',          'VARCHAR(32) NULL');
CALL migrate_047_add_column('subscription_events', 'provider_event_id', 'VARCHAR(191) NULL');
CALL migrate_047_add_index('subscription_events', 'uq_subscription_events_provider_event',
  'UNIQUE INDEX uq_subscription_events_provider_event (provider, provider_event_id)');
CALL migrate_047_add_index('subscription_events', 'idx_subscription_events_org_created',
  'INDEX idx_subscription_events_org_created (org_id, created_at)');

DROP PROCEDURE IF EXISTS migrate_047_add_column;
DROP PROCEDURE IF EXISTS migrate_047_add_index;

-- Roles del sistema (los permisos de cada rol viven en shared/rbac.js)
INSERT INTO roles (name, display_name)
SELECT seed.name, seed.display_name
  FROM (
    SELECT 'superadmin' AS name, 'Super Admin' AS display_name
    UNION ALL SELECT 'org_admin', 'Administrador'
    UNION ALL SELECT 'branch_manager', 'Gerente de sucursal'
    UNION ALL SELECT 'veterinarian', 'Veterinario/a'
    UNION ALL SELECT 'vet_technician', 'Técnico/a veterinario'
    UNION ALL SELECT 'receptionist', 'Recepcionista'
    UNION ALL SELECT 'groomer', 'Peluquero/a'
    UNION ALL SELECT 'grooming_manager', 'Gerente de grooming'
    UNION ALL SELECT 'tele_vet', 'Veterinario/a de telemedicina'
    UNION ALL SELECT 'pharmacist', 'Farmacéutico/a'
    UNION ALL SELECT 'accountant', 'Contador/a'
    UNION ALL SELECT 'lab_technician', 'Técnico/a de laboratorio'
    UNION ALL SELECT 'imaging_tech', 'Técnico/a de imágenes'
    UNION ALL SELECT 'surgeon', 'Cirujano/a'
    UNION ALL SELECT 'read_only', 'Solo lectura'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = seed.name);
