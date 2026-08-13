// scripts/crearSubcarpetasTanda.mjs
// Crea en DOCU\<dni> una subcarpeta por cada documento ACTIVO del orden (según la
// ley del agente), para todos los agentes de una tanda. No duplica; salta los
// que no tienen carpeta o ley. Espeja el endpoint /tandas/crear-subcarpetas.
// Uso: node scripts/crearSubcarpetasTanda.mjs --tanda=prueba
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = process.cwd();
const g = (k) => (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const DOCU = (g('TRAMITES_DOCU_BASE_DIR') || 'D:/G/DOCU').replace(/\\/g, '/');
const PROC = 'PASE A TRANSITORIA';
const safeSeg = (n) => path.basename(String(n).replace(/\\/g, '/')).replace(/[<>:"/\\|?*]/g, '_').replace(/[\x00-\x1F]/g, '').trim().replace(/\.+$/, '');
const tanda = String(args.tanda || '');
if (!tanda) { console.error('Falta --tanda='); process.exit(1); }

const c = await mysql.createConnection({ host: g('DB_HOST'), port: +g('DB_PORT'), user: g('DB_USER'), password: g('DB_PASS') || g('DB_PASSWORD'), database: g('DB_NAME') });
const [docs] = await c.query("SELECT ley,documento FROM orden_documentos_expediente WHERE proceso=? AND activo=1 ORDER BY ley,orden", [PROC]);
const porLey = {}; docs.forEach(d => { (porLey[d.ley] = porLey[d.ley] || []).push(d.documento); });
const [ags] = await c.query(`
  SELECT t.dni, CASE WHEN ocl.nombre LIKE '%10471%' THEN '10471' WHEN ocl.nombre LIKE '%10430%' THEN '10430' ELSE NULL END AS ley
  FROM tramites_tanda_interinos t
  JOIN personal p ON p.dni=t.dni AND p.deleted_at IS NULL
  LEFT JOIN agentes a ON a.dni=t.dni AND a.deleted_at IS NULL
  LEFT JOIN ocupaciones oc ON oc.id=a.ocupacion_id AND oc.deleted_at IS NULL
  LEFT JOIN ley ocl ON ocl.id=oc.ley_id AND ocl.deleted_at IS NULL
  WHERE t.tanda=?`, [tanda]);

let creadas = 0, existentes = 0, sinLey = 0, sinCarp = 0, proc = 0;
for (const a of ags) {
  const ley = a.ley === '10471' ? '10471' : a.ley === '10430' ? '10430' : null;
  if (!ley || !porLey[ley]) { sinLey++; continue; }
  const dir = path.join(DOCU, String(a.dni));
  if (!fs.existsSync(dir)) { sinCarp++; continue; }
  proc++;
  for (const doc of porLey[ley]) {
    const tgt = path.join(dir, safeSeg(doc));
    if (fs.existsSync(tgt)) existentes++; else { fs.mkdirSync(tgt, { recursive: true }); creadas++; }
  }
}
console.log(`Tanda "${tanda}": ${proc} agentes procesados · ${creadas} subcarpetas creadas · ${existentes} ya existían · ${sinLey} sin ley · ${sinCarp} sin carpeta.`);
await c.end();
