const { query, queryOne } = require('../config/database');
const logger = require('../config/logger');

// Migraciones idempotentes que corren al arrancar. Sirven para bases creadas
// con versiones anteriores del esquema: se pueden ejecutar todas las veces que
// haga falta sin romper nada.

const ROLES = ['admin', 'medium', 'read', 'telefonista', 'chofer'];

async function columnType(table, column) {
  const row = await queryOne(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return row?.type || null;
}

// Los roles telefonista y chofer se agregaron después del esquema original
async function ensureUserRoles() {
  const type = await columnType('users', 'role');
  if (!type || ROLES.every(r => type.includes(`'${r}'`))) return false;
  await query(
    `ALTER TABLE users MODIFY role ENUM(${ROLES.map(r => `'${r}'`).join(',')}) NOT NULL DEFAULT 'read'`
  );
  return true;
}

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS incident_number_sequences (
      year     SMALLINT UNSIGNED NOT NULL,
      last_seq INT UNSIGNED      NOT NULL DEFAULT 0,
      PRIMARY KEY (year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await query(`
    CREATE TABLE IF NOT EXISTS infrastructure_points (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      type        ENUM('HOSPITAL','SALITA','BOMBEROS','SAME','DEFENSA_CIVIL','CUARTEL_GN','OTRO') NOT NULL,
      name        VARCHAR(200) NOT NULL,
      address     VARCHAR(255) NULL,
      phone       VARCHAR(100) NULL,
      province_id INT UNSIGNED NULL,
      partido_id  INT UNSIGNED NULL,
      latitude    DECIMAL(10,8) NULL,
      longitude   DECIMAL(11,8) NULL,
      beds        INT UNSIGNED NULL,
      level       VARCHAR(30)  NULL,
      is_active   TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      KEY idx_infra_type     (type),
      KEY idx_infra_province (province_id),
      KEY idx_infra_coords   (latitude, longitude),
      CONSTRAINT fk_infra_province FOREIGN KEY (province_id) REFERENCES provinces (id),
      CONSTRAINT fk_infra_partido  FOREIGN KEY (partido_id)  REFERENCES partidos  (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

// La secuencia de numeración nunca puede quedar por detrás de los incidentes
// existentes (por ejemplo, los del seed), o el próximo alta chocaría.
async function syncIncidentSequence() {
  await query(`
    INSERT INTO incident_number_sequences (year, last_seq)
    SELECT CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(incident_number, '-', 2), '-', -1) AS UNSIGNED) AS y,
           MAX(CAST(SUBSTRING_INDEX(incident_number, '-', -1) AS UNSIGNED)) AS seq
    FROM incidents
    WHERE incident_number REGEXP '^DC-[0-9]{4}-[0-9]+$'
    GROUP BY y
    ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, VALUES(last_seq))`);
}

async function runMigrations() {
  await ensureTables();
  if (await ensureUserRoles()) logger.info('Migración: roles telefonista y chofer agregados');
  await syncIncidentSequence();
}

module.exports = { runMigrations };
