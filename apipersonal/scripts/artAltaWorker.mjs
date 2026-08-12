// Worker de escritorio para el alta ART con VENTANA VISIBLE (Chrome headed).
//
// Corre FUERA de pm2, en una sesion de Windows logueada (escritorio abierto). Hace el mismo
// poll atomico de la cola `art_alta_queue` que el worker in-process de la API, pero lanza el
// script con ART_HEADLESS=false -> Chrome visible. Asi:
//   - el menu de ART se ve (no mas "element is not visible" del headless), y
//   - usa la red de la sesion de escritorio (no la del servicio pm2).
//
// USO (parado en la carpeta apipersonal de prod, con sesion de escritorio abierta):
//   node scripts/artAltaWorker.mjs
//
// IMPORTANTE — para que no compita con el worker de pm2 por los mismos items:
//   En el .env de la API poner  ART_AUTO_ALTA_ENABLED=false  y reiniciar pm2.
//   (La cola se sigue llenando sola por el trigger; solo cambia QUIEN la procesa.)
//
// Requiere el mismo .env de apipersonal (DB_* y credenciales ART_*) que usa el script de alta.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

const SCRIPT = path.join(__dirname, 'provincia_art_alta_trabajador.mjs');
const POLL_MS = Number(process.env.ART_QUEUE_POLL_MS || 60000);
const MAX_ATTEMPTS = Number(process.env.ART_QUEUE_MAX_ATTEMPTS || 3);

function log(...args) {
  console.log(`[artAltaWorker ${new Date().toISOString()}]`, ...args);
}

function dbConfig() {
  const need = (n) => {
    const v = process.env[n]?.trim();
    if (!v) throw new Error(`Falta ${n} en .env`);
    return v;
  };
  return {
    host: need('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: need('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: need('DB_NAME'),
    dateStrings: true,
  };
}

let conn = null;
async function getConn() {
  if (conn) {
    try { await conn.ping(); return conn; } catch { conn = null; }
  }
  conn = await mysql.createConnection(dbConfig());
  return conn;
}

// Igual que takeNextQueueItem del worker in-process: agarra el proximo PENDING/ERROR y lo
// marca PROCESSING de forma atomica (el UPDATE con WHERE status IN (...) evita doble toma).
async function takeNext(c) {
  const [rows] = await c.query(
    `SELECT id FROM art_alta_queue
      WHERE status IN ('PENDING','ERROR')
        AND attempts < ?
        AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
      ORDER BY created_at ASC
      LIMIT 1`,
    [MAX_ATTEMPTS]
  );
  const id = rows[0]?.id;
  if (!id) return null;
  const [meta] = await c.query(
    `UPDATE art_alta_queue
        SET status='PROCESSING', attempts=attempts+1, locked_at=NOW(),
            started_at=COALESCE(started_at, NOW()), last_error=NULL
      WHERE id=? AND status IN ('PENDING','ERROR')`,
    [id]
  );
  return meta.affectedRows ? id : null;
}

// Lanza el script de alta con ventana visible. El propio script marca DONE/ERROR en la cola.
function runScript(queueId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--queue-id', String(queueId)], {
      cwd: appRoot,
      env: { ...process.env, ART_HEADLESS: 'false' }, // <- ventana VISIBLE
      stdio: 'inherit',                                // el avance se ve en esta consola
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`script salio con codigo ${code}`))));
  });
}

async function processOne() {
  const c = await getConn();
  const queueId = await takeNext(c);
  if (!queueId) return false;
  log(`procesando queue #${queueId} (Chrome visible)...`);
  try {
    await runScript(queueId);
    log(`queue #${queueId} OK`);
  } catch (err) {
    // el script ya dejo la cola en ERROR con el motivo; aca solo lo mostramos
    log(`queue #${queueId} FALLO: ${err?.message || err}`);
  }
  // Backstop anti-orfano: si el script murio SIN dejar estado terminal (Ctrl+C, crash de
  // import, kill), la fila se queda en PROCESSING y nunca mas la agarra nadie. Si sigue en
  // PROCESSING despues de que el hijo termino, la liberamos a ERROR y limpiamos locked_at.
  await c.query(
    `UPDATE art_alta_queue
        SET status='ERROR', locked_at=NULL,
            last_error=COALESCE(NULLIF(last_error,''), 'Worker: el proceso no dejo estado terminal')
      WHERE id=? AND status='PROCESSING'`,
    [queueId]
  ).catch(() => undefined);
  return true;
}

async function main() {
  log(`iniciado. poll=${POLL_MS}ms maxAttempts=${MAX_ATTEMPTS} DB=${process.env.DB_NAME}`);
  log('procesa art_alta_queue con Chrome VISIBLE. Ctrl+C para cortar.');
  for (;;) {
    let hadWork = false;
    try {
      hadWork = await processOne();
    } catch (err) {
      log(`error de loop: ${err?.message || err}`);
      conn = null; // fuerza reconexion en la proxima vuelta
    }
    if (!hadWork) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error('[artAltaWorker] fatal:', err?.message || err);
  process.exit(1);
});
