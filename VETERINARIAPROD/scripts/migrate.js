#!/usr/bin/env node
'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ROLLBACKS_DIR = path.join(__dirname, 'rollbacks');

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS migration_history (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    filename    VARCHAR(255) NOT NULL,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum    VARCHAR(64) NOT NULL,
    duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_migration_filename (filename)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS migration_rollback_history (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    filename       VARCHAR(255) NOT NULL,
    rolled_back_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_ms    INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function getConnection() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    database: process.env.MYSQL_DATABASE || 'vetmanager',
    user: process.env.MYSQL_USER || 'vetapp',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  });
}

function checksum(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function getRollbackFiles() {
  if (!fs.existsSync(ROLLBACKS_DIR)) return new Set();
  return new Set(fs.readdirSync(ROLLBACKS_DIR).filter((f) => f.endsWith('.sql')));
}

async function getApplied(conn) {
  const [rows] = await conn.execute('SELECT filename, checksum FROM migration_history');
  return new Map(rows.map((row) => [row.filename, row.checksum]));
}

function getChecksumDrift(files, applied) {
  return files
    .filter((file) => applied.has(file))
    .map((file) => {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const current = checksum(content);
      const recorded = applied.get(file);
      return current === recorded ? null : { file, recorded, current };
    })
    .filter(Boolean);
}

async function rollback(conn, files, applied, rollbackCount, isDry) {
  const rollbackFiles = getRollbackFiles();
  const appliedFiles = files.filter((file) => applied.has(file));
  const targets = appliedFiles.slice(-rollbackCount).reverse();

  if (!targets.length) {
    console.log('No applied migrations available to roll back.');
    return;
  }

  console.log(`Rolling back ${targets.length} migration(s)${isDry ? ' [DRY RUN]' : ''}...\n`);

  for (const filename of targets) {
    if (!rollbackFiles.has(filename)) {
      throw new Error(`Rollback file missing for ${filename}`);
    }
    if (isDry) {
      console.log(`  [DRY] Would roll back: ${filename}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(ROLLBACKS_DIR, filename), 'utf8');
    const t0 = Date.now();
    await conn.query(sql);
    const ms = Date.now() - t0;
    await conn.execute('DELETE FROM migration_history WHERE filename = ?', [filename]);
    await conn.execute(
      'INSERT INTO migration_rollback_history (filename, duration_ms) VALUES (?, ?)',
      [filename, ms]
    );
    console.log(`  rollback ${filename} (${ms}ms)`);
  }
}

async function applyPending(conn, files, applied, isDry) {
  const pending = files.filter((file) => !applied.has(file));
  if (!pending.length) {
    console.log('All migrations already applied.');
    return;
  }

  console.log(`Running ${pending.length} pending migration(s)${isDry ? ' [DRY RUN]' : ''}...\n`);

  for (const filename of pending) {
    const filepath = path.join(MIGRATIONS_DIR, filename);
    const content = fs.readFileSync(filepath, 'utf8');
    const hash = checksum(content);

    if (isDry) {
      console.log(`  [DRY] Would apply: ${filename}`);
      continue;
    }

    const t0 = Date.now();
    try {
      await conn.query(content);
      const ms = Date.now() - t0;
      await conn.execute(
        'INSERT INTO migration_history (filename, checksum, duration_ms) VALUES (?, ?, ?)',
        [filename, hash, ms]
      );
      console.log(`  applied ${filename} (${ms}ms)`);
    } catch (err) {
      console.error(`  failed ${filename}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied successfully.');
}

async function run() {
  const isDry = process.argv.includes('--dry-run');
  const isStatus = process.argv.includes('--status');
  const rollbackArgIndex = process.argv.findIndex((arg) => arg === '--rollback');
  const rollbackCount = rollbackArgIndex >= 0
    ? Math.max(1, parseInt(process.argv[rollbackArgIndex + 1] || '1', 10))
    : 0;

  const conn = await getConnection();
  try {
    await conn.query(ENSURE_TABLE);
    const files = getMigrationFiles();
    const applied = await getApplied(conn);
    const rollbackFiles = getRollbackFiles();
    const drift = getChecksumDrift(files, applied);

    if (isStatus) {
      console.log('\nMigration status:');
      for (const file of files) {
        const hasDrift = drift.some((item) => item.file === file);
        const status = applied.has(file) ? (hasDrift ? 'drift' : 'applied') : 'pending';
        const canRollback = rollbackFiles.has(file) ? 'rollback:yes' : 'rollback:no';
        console.log(`  ${status}  ${file}  (${canRollback})`);
      }
      if (drift.length) {
        console.log('\nChecksum drift detected:');
        for (const item of drift) {
          console.log(`  ${item.file}`);
        }
      }
      console.log(`\n${applied.size} applied, ${files.filter((f) => !applied.has(f)).length} pending\n`);
      return;
    }

    if (drift.length) {
      throw new Error(`Applied migration checksum drift detected: ${drift.map((item) => item.file).join(', ')}`);
    }

    if (rollbackCount > 0) {
      await rollback(conn, files, applied, rollbackCount, isDry);
      return;
    }

    await applyPending(conn, files, applied, isDry);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
