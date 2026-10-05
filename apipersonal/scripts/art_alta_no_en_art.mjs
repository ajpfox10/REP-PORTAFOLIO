// art_alta_no_en_art.mjs
// Da de alta en ART a los agentes que el control de establecimiento marcó NO_EN_ART
// (art_control_establecimiento.estado='NO_EN_ART') y que ya tienen domicilio en personal
// (ver art_domicilios_intranet_a_personal.mjs). Los encola en art_alta_queue directo en PROCESSING
// (el worker de pm2 sólo toma PENDING/ERROR, así no los pisa) y corre provincia_art_alta_trabajador.mjs
// --queue-id de a uno, en serie. Si el alta sale OK anota estado ALTA_OK en art_control_establecimiento.
// Excluye reemplazantes (ley REEMPLAZ*: no van a ART, igual que el trigger de la cola).
//
// Uso: node scripts/art_alta_no_en_art.mjs [--limit N]

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const SCRIPT = path.join(__dirname, 'provincia_art_alta_trabajador.mjs');
const li = process.argv.indexOf('--limit');
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) || 0 : 0;

function runOne(queueId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--queue-id', String(queueId)], {
      cwd: appRoot, env: { ...process.env, ART_HEADLESS: process.env.ART_HEADLESS || 'true' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += String(c); });
    child.stderr.on('data', (c) => { err += String(c); });
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.on('error', (e) => resolve({ code: -1, out: '', err: String(e) }));
  });
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'personalv5',
});
try {
  // Tramo ACTIVO más reciente de cada DNI (dni no es único en agentes: tramos de carrera).
  const [cands] = await conn.query(`
    SELECT a.id AS agente_id, a.dni, a.fecha_ingreso, a.estado_empleo, p.apellido
      FROM art_control_establecimiento e
      JOIN personal p ON p.dni = e.dni
      JOIN agentes a ON a.id = (SELECT a2.id FROM agentes a2 WHERE a2.dni = e.dni AND a2.estado_empleo = 'ACTIVO'
                                 AND a2.deleted_at IS NULL ORDER BY a2.id DESC LIMIT 1)
      LEFT JOIN ley l ON l.id = a.ley_id
     WHERE e.estado = 'NO_EN_ART'
       AND COALESCE(TRIM(p.domicilio),'') <> '' AND p.localidad_id IS NOT NULL
       AND UPPER(COALESCE(l.nombre,'')) NOT LIKE '%REEMPLAZ%'
     ORDER BY p.apellido`);
  const lista = LIMIT ? cands.slice(0, LIMIT) : cands;
  console.log(`[alta] candidatos con domicilio: ${cands.length} | a procesar: ${lista.length}`);
  let ok = 0, fail = 0;
  for (const c of lista) {
    await conn.query(`
      INSERT INTO art_alta_queue (agente_id, dni, fecha_ingreso_db, estado_empleo, status, attempts, locked_at, started_at)
      VALUES (?, ?, ?, ?, 'PROCESSING', 0, NOW(), NOW())
      ON DUPLICATE KEY UPDATE status='PROCESSING', attempts=0, locked_at=NOW(), started_at=NOW(),
        last_error=NULL, resultado_art=NULL`,
      [c.agente_id, c.dni, c.fecha_ingreso, c.estado_empleo]);
    const [[q]] = await conn.query('SELECT id FROM art_alta_queue WHERE agente_id = ?', [c.agente_id]);
    process.stdout.write(`[alta] ${c.apellido} DNI ${c.dni} (queue ${q.id}) … `);
    const res = await runOne(q.id);
    if (res.code === 0 && /"ok":true/.test(res.out)) {
      ok++; console.log('OK');
      await conn.query("UPDATE art_control_establecimiento SET estado='ALTA_OK', detalle=NULL, ultimo_intento=NOW() WHERE dni = ?", [c.dni]);
    } else {
      fail++;
      const [[e]] = await conn.query('SELECT last_error FROM art_alta_queue WHERE id = ?', [q.id]);
      console.log(`FALLÓ: ${String(e?.last_error || res.err || res.out).replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }
  console.log(`[alta] fin. OK=${ok} FALLARON=${fail}`);
} finally { await conn.end(); }
