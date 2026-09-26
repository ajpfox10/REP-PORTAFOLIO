// scripts/seed_residencias.mjs
// Carga inicial del modulo "Duracion de residencias":
//   1) crea las tablas si no existen (mismo DDL que el router),
//   2) siembra el catalogo de residencias con su cantidad de anios,
//   3) asigna la residencia a cada agente cruzando el "Listado de residentes" por nombre.
//
// Uso:  node scripts/seed_residencias.mjs [--dry]
// El listado vive en scripts/data/listado_residentes.json  { "RESIDENCIA": ["Apellido Nombre", ...] }
// Un item puede ser "Apellido Nombre|DNI" para fijar el agente cuando el nombre no cruza solo.

import fs from 'fs';
import path from 'path';
import url from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY = process.argv.includes('--dry');

const CATALOGO = [
  ['TERAPIA INTENSIVA', 4, null],
  ['CIRUGIA GENERAL', 4, null],
  ['TRAUMATOLOGIA', 4, null],
  ['CLINICA MEDICA', 4, null],
  ['TOCOGINECOLOGIA', 4, null],
  ['ANESTESIOLOGIA', 4, null],
  ['TRABAJO SOCIAL', 3, null],
  ['FONOAUDIOLOGIA', 3, null],
  ['DERECHO Y SALUD', 3, 'Duracion a confirmar'],
  ['PRE RESIDENTES', 1, 'Duracion a confirmar'],
];

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'personalv5',
  dateStrings: true,
});

// ── 1) Tablas ────────────────────────────────────────────────────────────────
await conn.query(`
  CREATE TABLE IF NOT EXISTS residencias (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    nombre        VARCHAR(120) NOT NULL,
    anios         INT NOT NULL DEFAULT 4,
    activa        TINYINT(1) NOT NULL DEFAULT 1,
    observaciones VARCHAR(500) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_residencias_nombre (nombre)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
await conn.query(`
  CREATE TABLE IF NOT EXISTS residentes_residencia (
    dni           INT NOT NULL PRIMARY KEY,
    residencia_id INT NOT NULL,
    fecha_inicio  DATE NULL,
    observaciones VARCHAR(500) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_residentes_residencia_res (residencia_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
await conn.query(`
  CREATE TABLE IF NOT EXISTS residencias_bajas (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    dni                 INT NOT NULL,
    ciclo               INT NOT NULL,
    residencia_id       INT NULL,
    residencia_nombre   VARCHAR(120) NULL,
    anios_cumplidos     INT NULL,
    anios_residencia    INT NULL,
    fecha_corte         DATE NOT NULL,
    estado              ENUM('PENDIENTE','BAJA','NO_CORRESPONDE') NOT NULL DEFAULT 'PENDIENTE',
    fecha_baja          DATE NULL,
    observaciones       VARCHAR(500) NULL,
    resuelto_por        INT NULL,
    resuelto_por_nombre VARCHAR(200) NULL,
    resuelto_at         DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_residencias_bajas (dni, ciclo),
    KEY idx_residencias_bajas_estado (estado)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

// ── 2) Catalogo ──────────────────────────────────────────────────────────────
for (const [nombre, anios, obs] of CATALOGO) {
  if (DRY) continue;
  await conn.query(
    `INSERT INTO residencias (nombre, anios, observaciones) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE anios = IF(anios = VALUES(anios), anios, anios)`,
    [nombre, anios, obs],
  );
}
const [resRows] = await conn.query(`SELECT id, nombre FROM residencias`);
const idPorResidencia = new Map(resRows.map((r) => [r.nombre, r.id]));

// ── 3) Asignacion por agente ─────────────────────────────────────────────────
const listadoPath = path.join(__dirname, 'data', 'listado_residentes.json');
if (!fs.existsSync(listadoPath)) {
  console.log(`Catalogo listo. Sin listado en ${listadoPath}: no se asigna nada.`);
  await conn.end();
  process.exit(0);
}
const listado = JSON.parse(fs.readFileSync(listadoPath, 'utf8'));

const [padronRows] = await conn.query(`
  SELECT p.dni, p.apellido, p.nombre, a.fecha_ingreso
  FROM personal p
  JOIN agentes a ON a.id = (SELECT ax.id FROM agentes ax WHERE ax.dni = p.dni AND ax.deleted_at IS NULL
                            ORDER BY (ax.estado_empleo='ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC LIMIT 1)
  WHERE p.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
`);
const padron = padronRows.map((r) => ({
  ...r,
  apellidoTokens: new Set(norm(r.apellido).split(' ').filter(Boolean)),
  tokens: new Set([...norm(r.apellido).split(' '), ...norm(r.nombre).split(' ')].filter(Boolean)),
}));

/** El apellido pesa: sin apellido en comun no es la misma persona. */
function buscar(nombreListado) {
  const t = norm(nombreListado).split(' ').filter(Boolean);
  let mejor = null;
  for (const p of padron) {
    let hits = 0; let apeHits = 0;
    for (const w of t) {
      if (p.tokens.has(w)) hits += 1;
      if (p.apellidoTokens.has(w)) apeHits += 1;
    }
    if (apeHits === 0) continue;
    const score = apeHits * 10 + hits;
    if (!mejor || score > mejor.score) mejor = { p, score, hits, apeHits };
  }
  return mejor && mejor.hits >= 2 ? mejor.p : null;
}

let asignados = 0;
const sinMatch = [];
for (const [residencia, nombres] of Object.entries(listado)) {
  const rid = idPorResidencia.get(norm(residencia));
  if (!rid) { console.log(`! Residencia sin catalogo: ${residencia}`); continue; }
  for (const entrada of nombres) {
    // "Apellido Nombre|DNI" fija el agente a mano cuando el nombre no cruza solo
    const [n, dniFijo] = String(entrada).split('|');
    const p = dniFijo ? { dni: Number(dniFijo) } : buscar(n);
    if (!p) { sinMatch.push(`${residencia} :: ${n}`); continue; }
    if (!DRY) {
      await conn.query(
        `INSERT INTO residentes_residencia (dni, residencia_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE residencia_id = VALUES(residencia_id)`,
        [p.dni, rid],
      );
    }
    asignados += 1;
  }
}

console.log(`${DRY ? '[DRY] ' : ''}Residencias en catalogo: ${idPorResidencia.size}`);
console.log(`${DRY ? '[DRY] ' : ''}Residentes asignados: ${asignados}`);
if (sinMatch.length) {
  console.log(`Sin match en el padron (${sinMatch.length}):`);
  for (const s of sinMatch) console.log(`  - ${s}`);
}

await conn.end();
