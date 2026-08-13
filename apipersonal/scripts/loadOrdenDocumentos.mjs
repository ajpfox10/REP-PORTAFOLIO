// scripts/loadOrdenDocumentos.mjs
// Carga la "orden de trabajo" (ORDEN EN BASE.xlsx): el orden correcto de los
// documentos de un expediente de PASE A TRANSITORIA, por ley (10430 / 10471),
// con la nota por documento y la aclaracion general.
// Idempotente (INSERT ... ON DUPLICATE KEY UPDATE). Uso: node scripts/loadOrdenDocumentos.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const XLSX_PATH = 'C:/Users/Administrator/Desktop/ORDEN EN BASE.xlsx';
const PROCESO = 'PASE A TRANSITORIA';

const envRaw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = (k) => (envRaw.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];

const txt = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

// --- Leer el Excel ---
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Columnas: [0]=orden 10430, [1]=doc 10430, [2]=nota 10430, [3]=orden 10471, [4]=doc 10471, [5]=nota 10471
const docs = [];
for (const r of rows) {
  const o1 = Number(r[0]);
  if (Number.isInteger(o1) && o1 > 0 && txt(r[1])) {
    docs.push({ ley: '10430', orden: o1, documento: txt(r[1]), observacion: txt(r[2]) });
  }
  const o2 = Number(r[3]);
  if (Number.isInteger(o2) && o2 > 0 && txt(r[4])) {
    docs.push({ ley: '10471', orden: o2, documento: txt(r[4]), observacion: txt(r[5]) });
  }
}

// Un documento = un renglon: colapsa los que en el Excel vienen partidos por
// pagina/frente/hoja (DNI Frente/Dorso, Declaracion jurada Hoja 1/2,
// Planilla de incompatibilidad H.1/2/3, DDJJ Cond. De Salud H.1..4, etc).
const baseName = (s) => String(s).trim()
  .replace(/\s+(frente|dorso)\s*$/i, '')
  .replace(/\s+hoja\s*\d+\s*$/i, '')
  .replace(/\s+h\.?\s*\d+\s*$/i, '')
  .replace(/\s{2,}/g, ' ').trim();

function consolidar(lista) {
  const out = [];
  // Procesa cada ley por separado (en `docs` los renglones vienen intercalados).
  const leyes = [...new Set(lista.map((d) => d.ley))];
  for (const ley of leyes) {
    const items = lista.filter((d) => d.ley === ley).sort((a, b) => a.orden - b.orden);
    let last = null;
    let n = 0;
    for (const d of items) {
      const b = baseName(d.documento);
      if (last && last.documento === b) {
        if (!last.observacion && d.observacion) last.observacion = d.observacion;
        continue;
      }
      n += 1;
      last = { ley, orden: n, documento: b, observacion: d.observacion };
      out.push(last);
    }
  }
  return out;
}

const docsConsolidados = consolidar(docs);

// Aclaracion general: el bloque de texto largo al pie (fila A con "Aclaracion")
let aclaracion = null;
for (const r of rows) {
  const s = txt(r[0]);
  if (s && /aclaraci/i.test(s) && s.length > 60) { aclaracion = s; break; }
}

const conn = await mysql.createConnection({
  host: env('DB_HOST') || '127.0.0.1',
  port: Number(env('DB_PORT') || 3306),
  user: env('DB_USER'),
  password: env('DB_PASS') || env('DB_PASSWORD'),
  database: env('DB_NAME'),
  multipleStatements: true,
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS orden_documentos_expediente (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    proceso      VARCHAR(80)  NOT NULL,
    ley          VARCHAR(20)  NOT NULL,
    orden        INT          NOT NULL,
    documento    VARCHAR(200) NOT NULL,
    observacion  TEXT         NULL,
    activo       TINYINT(1)   NOT NULL DEFAULT 1,
    UNIQUE KEY uq_proc_ley_orden (proceso, ley, orden),
    KEY idx_proceso_ley (proceso, ley)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

// Si la tabla ya existia sin la columna activo (se agrego despues), la incorpora.
{
  const [col] = await conn.query(
    "SHOW COLUMNS FROM orden_documentos_expediente LIKE 'activo'"
  );
  if (!col.length) {
    await conn.query(
      'ALTER TABLE orden_documentos_expediente ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER observacion'
    );
  }
}

await conn.query(`
  CREATE TABLE IF NOT EXISTS orden_documentos_aclaracion (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    proceso  VARCHAR(80) NOT NULL,
    texto    TEXT        NOT NULL,
    UNIQUE KEY uq_proceso (proceso)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

// RESET: reescribe el orden desde el Excel (consolidado). Re-ejecutar vuelve
// al baseline y descarta cambios hechos por la UI (orden/activo).
await conn.query('DELETE FROM orden_documentos_expediente WHERE proceso=?', [PROCESO]);
let ins = 0;
for (const d of docsConsolidados) {
  await conn.query(
    `INSERT INTO orden_documentos_expediente (proceso, ley, orden, documento, observacion, activo)
     VALUES (?,?,?,?,?,1)`,
    [PROCESO, d.ley, d.orden, d.documento, d.observacion]
  );
  ins += 1;
}

if (aclaracion) {
  await conn.query(
    `INSERT INTO orden_documentos_aclaracion (proceso, texto) VALUES (?,?)
     ON DUPLICATE KEY UPDATE texto=VALUES(texto)`,
    [PROCESO, aclaracion]
  );
}

const [resumen] = await conn.query(
  `SELECT ley, COUNT(*) n FROM orden_documentos_expediente WHERE proceso=? GROUP BY ley ORDER BY ley`,
  [PROCESO]
);

console.log('Documentos procesados:', ins);
console.log('Por ley:', resumen.map((r) => `${r.ley}=${r.n}`).join('  '));
console.log('Aclaracion general:', aclaracion ? 'cargada' : 'no encontrada');

await conn.end();
