// art_control_desde_log.mjs
// Carga en art_control_establecimiento los resultados que quedaron solo en el log del robot
// (logs/art_editar_establecimiento.log), p.ej. de una corrida lanzada con la versión que todavía
// no escribía en la tabla. Re-ejecutable: por DNI se queda con el último resultado del log y
// no pisa una fila de la tabla más nueva que ese resultado.
//
// Uso: node scripts/art_control_desde_log.mjs [--desde "2026-09-29 23:28"]
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const LOG = path.join(__dirname, 'logs', 'art_editar_establecimiento.log');
const i = process.argv.indexOf('--desde');
const DESDE = i > 0 ? process.argv[i + 1] : '0000';
const dig = (s) => String(s ?? '').replace(/\D/g, '');

// Estado del robot → estado de la tabla
function estadoDe(txt) {
  if (/^OK$/.test(txt)) return ['OK', null];
  if (/ya está SOLO en destino/.test(txt)) return ['YA_OK', null];
  if (/NO está en ART/.test(txt)) return ['NO_EN_ART', null];
  if (/^PARCIAL/.test(txt)) return ['PARCIAL', txt];
  if (/^ERROR/.test(txt)) return ['ERROR', txt.replace(/^ERROR\s*/, '')];
  return [null, null];
}

const ultimo = new Map();   // cuil -> { estado, detalle, fecha }
let fecha = null, activa = false;
for (const linea of fs.readFileSync(LOG, 'utf8').split(/\r?\n/)) {
  const h = linea.match(/^==== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) .*--apply/);
  if (h) { fecha = h[1]; activa = fecha >= DESDE; continue; }
  if (/^==== /.test(linea)) { activa = false; continue; }
  const m = activa && linea.match(/^(\d{2}-\d{8}-\d):\s*(.+)$/);
  if (!m) continue;
  const [estado, detalle] = estadoDe(m[2].trim());
  if (estado) ultimo.set(m[1], { estado, detalle, fecha });
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'personalv5',
});
const [pers] = await db.query("SELECT dni, cuil FROM personal WHERE cuil IS NOT NULL AND cuil <> ''");
const dniPorCuil = new Map(pers.filter((r) => dig(r.cuil).length === 11).map((r) => [dig(r.cuil), r.dni]));

let n = 0, sinDni = 0;
for (const [cuil, r] of ultimo) {
  const dni = dniPorCuil.get(dig(cuil));
  if (!dni) { sinDni++; continue; }
  const [res] = await db.query(`
    INSERT INTO art_control_establecimiento
      (dni, cuil, establecimiento_destino, estado, detalle, intentos, ultimo_intento)
    VALUES (?, ?, '488242', ?, ?, 1, ?)
    ON DUPLICATE KEY UPDATE
      estado = IF(ultimo_intento IS NULL OR ultimo_intento <= VALUES(ultimo_intento), VALUES(estado), estado),
      detalle = IF(ultimo_intento IS NULL OR ultimo_intento <= VALUES(ultimo_intento), VALUES(detalle), detalle),
      ultimo_intento = GREATEST(COALESCE(ultimo_intento, VALUES(ultimo_intento)), VALUES(ultimo_intento))`,
    [dni, cuil, r.estado, r.detalle ? r.detalle.slice(0, 500) : null, r.fecha]);
  n += res.affectedRows ? 1 : 0;
}
await db.end();
console.log(`Del log: ${ultimo.size} agentes · anotados/actualizados: ${n} · sin DNI en personal: ${sinDni}`);
