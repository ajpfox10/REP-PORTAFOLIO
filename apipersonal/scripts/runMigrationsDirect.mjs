// Corre SOLO migraciones pendientes que no estén en schema_migrations
// Si la tabla está vacía y hay migraciones viejas ya aplicadas, las registra sin ejecutarlas
// pasando --seed-existing como argumento.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const seedExisting = process.argv.includes('--seed-existing');
const only = process.argv.find(a => a.startsWith('--only='))?.replace('--only=', '').split(',') ?? null;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'personalv5',
  multipleStatements: true,
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    filename VARCHAR(255) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_filename (filename)
  ) ENGINE=InnoDB;
`);

const [applied] = await conn.query('SELECT filename, checksum FROM schema_migrations');
const appliedMap = new Map(applied.map(r => [r.filename, r.checksum]));

const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.toLowerCase().endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b, 'en'));

let total = 0;
for (const filename of files) {
  // Si se pasó --only, filtrar
  if (only && !only.some(o => filename.includes(o))) {
    console.log(`  ⏭  skipped (not in --only): ${filename}`);
    continue;
  }

  const full = path.join(migrationsDir, filename);
  const sql = fs.readFileSync(full, 'utf-8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');

  if (appliedMap.has(filename)) {
    if (appliedMap.get(filename) !== checksum) {
      console.error(`❌ CHECKSUM MISMATCH: ${filename}`);
      process.exit(1);
    }
    console.log(`  ⏭  already applied: ${filename}`);
    continue;
  }

  if (seedExisting) {
    // Solo registrar sin ejecutar (para migraciones ya aplicadas)
    await conn.query(
      'INSERT IGNORE INTO schema_migrations (filename, checksum) VALUES (?, ?)',
      [filename, checksum]
    );
    console.log(`  📌 seeded (no exec): ${filename}`);
    continue;
  }

  console.log(`  ▶  applying: ${filename}`);
  try {
    await conn.query(sql);
    await conn.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)',
      [filename, checksum]
    );
    console.log(`  ✅ done:     ${filename}`);
    total++;
  } catch (err) {
    console.error(`  ❌ ERROR en ${filename}:`, err.message);
    await conn.end();
    process.exit(1);
  }
}

await conn.end();
if (seedExisting) {
  console.log('\n✔ Migraciones existentes registradas en schema_migrations.');
} else {
  console.log(`\n✔ Migraciones aplicadas: ${total}`);
}
