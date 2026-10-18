'use strict';

// Aplica en orden los archivos de migrations/ que todavía no corrieron.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

async function migrate({ log = console.log } = {}) {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const [done] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(done.map((row) => row.name));
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      log(`  aplicada ${file}`);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Migraciones al día.'))
    .catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { migrate };
