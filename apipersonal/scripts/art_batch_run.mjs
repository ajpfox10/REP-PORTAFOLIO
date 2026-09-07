// art_batch_run.mjs
// Procesa en lote la cola de alta ART con el script YA CORREGIDO (menú nuevo /nomina-trabajadores).
// Autónomo: no depende del worker de pm2 (que en prod puede tener el .mjs viejo). Reclama las
// filas a PROCESSING (bloquea al worker viejo, que sólo toma PENDING/ERROR) y corre el script
// --queue-id de a una, en serie. Al final imprime un resumen.
//
// Uso: node scripts/art_batch_run.mjs
// Env (del .env): DB_*, ART_* ; respeta ART_HEADLESS (default true).

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

const SCRIPT = path.join(__dirname, 'provincia_art_alta_trabajador.mjs');

function dbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personalv5',
  };
}

function runOne(queueId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--queue-id', String(queueId)], {
      cwd: appRoot,
      env: { ...process.env, ART_HEADLESS: process.env.ART_HEADLESS || 'true' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += String(c); });
    child.stderr.on('data', (c) => { err += String(c); });
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.on('error', (e) => resolve({ code: -1, out: '', err: String(e) }));
  });
}

async function main() {
  const conn = await mysql.createConnection(dbConfig());
  try {
    // 1) Reclamar todo lo que no está cargado (ERROR o PENDING) → PROCESSING attempts=0.
    //    Así el worker viejo de pm2 no las toca (sólo agarra PENDING/ERROR) y no pisa el lote.
    const [claim] = await conn.query(
      `UPDATE art_alta_queue
          SET status='PROCESSING', attempts=0, locked_at=NOW(), started_at=NOW(), last_error=NULL
        WHERE status IN ('ERROR','PENDING')`
    );
    console.log(`[batch] reclamadas ${claim.affectedRows} filas a PROCESSING`);

    // 2) Traer los ids reclamados (los que quedaron PROCESSING con locked_at reciente).
    const [rows] = await conn.query(
      `SELECT id, dni FROM art_alta_queue
        WHERE status='PROCESSING' AND locked_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        ORDER BY id ASC`
    );
    console.log(`[batch] a procesar: ${rows.length}`);

    let ok = 0, fail = 0;
    for (const r of rows) {
      process.stdout.write(`[batch] queue ${r.id} (DNI ${r.dni}) … `);
      const res = await runOne(r.id);
      if (res.code === 0 && /"ok":true/.test(res.out)) { ok++; console.log('OK'); }
      else { fail++; console.log(`FALLÓ (code ${res.code}) ${(res.err || res.out).slice(-160)}`); }
    }

    const [resumen] = await conn.query(`SELECT status, COUNT(*) c FROM art_alta_queue GROUP BY status`);
    console.log(`[batch] fin. OK=${ok} FALLARON=${fail}`);
    console.log('[batch] resumen:', resumen.map((x) => `${x.status}:${x.c}`).join('  '));
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[batch] error fatal:', e?.message || e); process.exitCode = 1; });
