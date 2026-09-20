// scripts/backfillSubidoFichero.mjs
//
// Rellena checkinout.subido_en / subido_archivo a partir de los .txt que el modulo
// Fichero ya genero y subio. Sin esto, al pasar el ciclo a "subido_en IS NULL" el
// primer ciclo reenviaria toda la historia del piso en adelante.
//
// Uso:
//   node scripts/backfillSubidoFichero.mjs [--dir <carpeta de .txt>] [--dry]
//
// Es idempotente: solo toca filas con subido_en IS NULL.

import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const argOf = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def; };
const DRY = args.includes('--dry');
const BASE = process.cwd();

const cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'fichero_config.json'), 'utf8'));
const DIR = path.resolve(argOf('--dir', path.isAbsolute(cfg.outputDir) ? cfg.outputDir : path.join(BASE, cfg.outputDir)));

if (!fs.existsSync(DIR)) { console.error(`No existe la carpeta ${DIR}`); process.exit(1); }

// ─── 1. Leer los archivos generados ──────────────────────────────────────────
// Linea: DNI<dni><pad>,DD/MM/YYYY HH:MM:SS<pad>,E|S,1,<nombre>,
const subidas = new Map();   // "dni|YYYY-MM-DD HH:MM:SS" -> { archivo, subidoEn }
let archivos = 0;

for (const nombre of fs.readdirSync(DIR)) {
  if (!nombre.endsWith('.txt')) continue;
  archivos++;
  const full = path.join(DIR, nombre);
  const subidoEn = fmtIso(fs.statSync(full).mtime);
  const archivo = nombre.replace(/\.txt$/, '');
  for (const linea of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const p = linea.split(',');
    if (p.length < 3) continue;
    const dni = p[0].replace('DNI', '').trim();
    const fh = p[1].trim();
    if (!dni || !/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(fh)) continue;
    const [d, m, y] = fh.slice(0, 10).split('/');
    const key = `${dni}|${y}-${m}-${d} ${fh.slice(11)}`;
    // Si aparece en varios archivos, gana el mas viejo (la subida original)
    const prev = subidas.get(key);
    if (!prev || subidoEn < prev.subidoEn) subidas.set(key, { archivo, subidoEn });
  }
}
console.log(`Archivos leidos: ${archivos} | fichadas distintas en los .txt: ${subidas.size}`);

// ─── 2. Marcar en la base ────────────────────────────────────────────────────
const conn = await mysql.createConnection({
  host: cfg.mysqlHost, port: cfg.mysqlPort, user: cfg.mysqlUser,
  password: cfg.mysqlPass, database: cfg.mysqlDb, dateStrings: true,
});

await asegurarColumnas(conn, DRY);

const [users] = await conn.query('SELECT userid, badgenumber FROM userinfo');
const porDni = new Map(users.map(u => [String(u.badgenumber).trim(), u.userid]));

const filas = [];
let sinUsuario = 0;
for (const [key, val] of subidas) {
  const [dni, checktime] = key.split('|');
  const userid = porDni.get(dni);
  if (!userid) { sinUsuario++; continue; }
  filas.push([userid, checktime, val.subidoEn, val.archivo.slice(0, 80)]);
}
console.log(`Filas a marcar: ${filas.length} | sin usuario en userinfo: ${sinUsuario}`);

if (DRY) { console.log('--dry: no se escribio nada'); await conn.end(); process.exit(0); }

await conn.query('DROP TEMPORARY TABLE IF EXISTS tmp_fichero_subidas');
await conn.query(`
  CREATE TEMPORARY TABLE tmp_fichero_subidas (
    userid INT NOT NULL, checktime DATETIME NOT NULL,
    subido_en DATETIME NOT NULL, archivo VARCHAR(80) NOT NULL,
    PRIMARY KEY (userid, checktime)
  ) ENGINE=InnoDB`);

for (let i = 0; i < filas.length; i += 2000) {
  const lote = filas.slice(i, i + 2000);
  await conn.query(
    'INSERT IGNORE INTO tmp_fichero_subidas (userid, checktime, subido_en, archivo) VALUES ?',
    [lote]
  );
}

// checkinout tiene UNIQUE KEY (userid, checktime), asi que el join es exacto
const [upd] = await conn.query(`
  UPDATE checkinout ci
    INNER JOIN tmp_fichero_subidas t
       ON t.userid = ci.userid AND t.checktime = ci.checktime
     SET ci.subido_en = t.subido_en, ci.subido_archivo = t.archivo
   WHERE ci.subido_en IS NULL`);
console.log(`Marcadas: ${upd.affectedRows}`);

await conn.query('DROP TEMPORARY TABLE IF EXISTS tmp_fichero_subidas');
await conn.end();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtIso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function asegurarColumnas(c, dry = false) {
  const [cols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checkinout'
        AND COLUMN_NAME IN ('subido_en','subido_archivo')`);
  const hay = new Set(cols.map(x => x.COLUMN_NAME));
  const faltan = [];
  if (!hay.has('subido_en')) faltan.push('ADD COLUMN subido_en DATETIME NULL');
  if (!hay.has('subido_archivo')) faltan.push('ADD COLUMN subido_archivo VARCHAR(80) NULL');
  if (faltan.length && dry) console.log(`[dry] faltarian ${faltan.length} columnas`);
  else if (faltan.length) { await c.query(`ALTER TABLE checkinout ${faltan.join(', ')}`); console.log(`Columnas creadas: ${faltan.length}`); }
  const [idx] = await c.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checkinout' AND INDEX_NAME = 'idx_checkinout_subido'`);
  if (!idx.length && dry) console.log('[dry] faltaria el indice');
  else if (!idx.length) { await c.query('ALTER TABLE checkinout ADD INDEX idx_checkinout_subido (subido_en, checktime)'); console.log('Indice creado'); }
}
