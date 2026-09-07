// cargar_stress.mjs - Orquestador de carga ANUAL COMPLEMENTARIA (stress >=90) en SIAPE
//   --build : calcula la cola de >=90, deduplica vs stress_cargados, upsert cola_carga_stress, escribe worklist.csv
// Reusa la logica del endpoint /stress/alertas pero con umbral 90 para la CARGA.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';

const AUTOIT = 'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..'); // apipersonal
const env = readEnv(path.join(ROOT, '.env'));

const HOY = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
const ANIO = HOY.getFullYear() - 1;                 // "año anterior al en curso"
const UMBRAL = Number.parseInt(env.STRESS_UMBRAL_DIAS ?? '', 10) || 35;  // dias para la CARGA (disparo). Configurable en .env: STRESS_UMBRAL_DIAS
const LEY_12 = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
// Variante de licencia por ley:
const VAR_10430 = new Set([1, 3]);                          // solo LEY 10430 -> "ANUAL COMPLEMENTARIA 10430"
const VAR_PLAIN = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // 10471 + TODAS las becas + RESIDENTES -> "ANUAL COMPLEMENTARIA"

function readEnv(fp) {
  const o = {};
  if (!fs.existsSync(fp)) return o;
  for (const raw of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    let k = l.slice(0, i).trim();
    let v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    o[k] = v;
  }
  return o;
}
function parseDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const M = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const mo = M[m[2].toUpperCase()];
    if (mo === undefined) return null;
    let y = parseInt(m[3]);
    if (y < 100) y += 2000;
    return new Date(y, mo, parseInt(m[1]));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function calcularStress(leyId, fechaIngreso) {
  if (!leyId) return null;
  if (LEY_12.has(leyId)) return 12;
  if (fechaIngreso) {
    const fi = new Date(fechaIngreso);
    if (fi.getFullYear() < 1900) return null;
    const anios = (HOY - fi) / (365.25 * 24 * 3600 * 1000);
    if (anios < 5) return 6;
    if (anios < 10) return 9;
    if (anios < 20) return 12;
    return 14;
  }
  return null;
}
function variante(leyId) {
  if (VAR_10430.has(leyId)) return 'ANUAL COMPLEMENTARIA 10430';
  if (VAR_PLAIN.has(leyId)) return 'ANUAL COMPLEMENTARIA';   // 10471 y Beca Contingencia
  return null;                                               // otras becas / leyes: omitido (confirmar)
}

async function build(dniFilter = null, force = false) {
  const dir = env.EXCEL_ASISTENCIA_DIR;
  const xlsPath = path.join(dir, 'Tiempo Acumulado.xls');
  if (!fs.existsSync(xlsPath)) throw new Error('No existe ' + xlsPath);
  const wb = XLSX.readFile(xlsPath, { cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const dniDias = new Map();
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[2] == null) continue;
    const dni = parseInt(String(r[2]).replace(/\D/g, ''));
    if (!dni) continue;
    const d = typeof r[5] === 'number' ? r[5] : parseFloat(String(r[5] ?? '0')) || 0;
    dniDias.set(dni, (dniDias.get(dni) ?? 0) + d);
  }
  const atZero = [...dniDias.entries()].filter(([, t]) => t === 0).map(([d]) => d);
  console.log(`Tiempo Acumulado: ${dniDias.size} agentes, ${atZero.length} con 0 dias`);
  if (!atZero.length) return;

  const cn = await mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1', port: +(env.DB_PORT || 3306),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'personalv5',
  });

  const [hist] = await cn.query(
    `SELECT dni, apellido, nombre, novedad, fecha_hasta FROM historial
     WHERE dni IN (?) AND (UPPER(novedad) LIKE '%ANUAL COMPLEMENTARIA%' OR UPPER(TRIM(novedad))='ANUAL')`,
    [atZero]);
  // Solo importa la ANUAL (para saber cuando tomo vacaciones). NO se evaluan
  // complementarias de años anteriores: si en el Tiempo Acumulado del año que se
  // carga esta en 0 (atZero), es que NO tiene la de este año -> corresponde.
  const ultAnual = new Map(), nom = new Map();
  for (const row of hist) {
    const dni = parseInt(String(row.dni).replace(/\D/g, ''));
    if (!dni) continue;
    const nv = String(row.novedad ?? '').trim().toUpperCase();
    if (!nom.has(dni)) nom.set(dni, `${row.apellido ?? ''} ${row.nombre ?? ''}`.trim());
    if (nv === 'ANUAL') {
      const f = parseDateStr(row.fecha_hasta);
      if (f) { const c = ultAnual.get(dni); if (!c || f > c) ultAnual.set(dni, f); }
    }
  }
  const elegibles = [];
  for (const dni of atZero) {
    const u = ultAnual.get(dni);
    if (!u) continue;                       // sin ANUAL registrada -> no se sabe cuando tomo vacaciones
    const dias = Math.floor((HOY - u) / (24 * 3600 * 1000));
    if (dias < UMBRAL) continue;            // aun no pasaron los dias desde el fin de la ANUAL
    elegibles.push({ dni, nombre: nom.get(dni) || '', dt: dias });
  }
  console.log(`Elegibles >=${UMBRAL} dias: ${elegibles.length}`);
  if (dniFilter) {
    for (let i = elegibles.length - 1; i >= 0; i--) if (elegibles[i].dni !== dniFilter) elegibles.splice(i, 1);
    console.log(`Filtrado a DNI ${dniFilter}: ${elegibles.length} fila(s)`);
  }

  const dnis = elegibles.map(e => e.dni);
  const agMap = new Map();
  if (dnis.length) {
    const [ag] = await cn.query(
      `SELECT a.dni, a.ley_id, l.nombre AS ley, a.fecha_ingreso
       FROM agentes a LEFT JOIN ley l ON a.ley_id=l.id
       WHERE a.dni IN (?) AND a.deleted_at IS NULL ORDER BY a.id DESC`, [dnis]);
    for (const r of ag) if (!agMap.has(r.dni)) agMap.set(r.dni, r);
  }

  const [led] = await cn.query(`SELECT dni FROM stress_cargados WHERE anio=?`, [ANIO]);
  const yaCargado = force ? new Set() : new Set(led.map(r => r.dni));
  if (force) console.log('FORCE: ignorando ledger (permite recargar aunque figure cargado)');

  const work = [];
  let pend = 0, omit = 0, dup = 0;
  for (const e of elegibles) {
    const ag = agMap.get(e.dni);
    const leyId = ag?.ley_id ?? null;
    const ley = ag?.ley ?? '(sin ley)';
    const dias = calcularStress(leyId, ag?.fecha_ingreso ? new Date(ag.fecha_ingreso) : null);
    const lic = variante(leyId);
    let estado = 'pendiente', motivo = null;
    if (yaCargado.has(e.dni)) { estado = 'cargado'; motivo = 'ya en ledger'; dup++; }
    else if (!lic) { estado = 'omitido'; motivo = `ley sin regla de variante (ley_id=${leyId} ${ley})`; omit++; }
    else if (!dias) { estado = 'omitido'; motivo = 'sin dias de stress (antiguedad/ley)'; omit++; }
    else pend++;
    await cn.query(
      `INSERT INTO cola_carga_stress (dni,apellido,anio,dias,licencia,ley,dias_transcurridos,estado,motivo)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE apellido=VALUES(apellido),dias=VALUES(dias),licencia=VALUES(licencia),
         ley=VALUES(ley),dias_transcurridos=VALUES(dias_transcurridos),
         estado=IF(estado='cargado','cargado',VALUES(estado)),motivo=VALUES(motivo)`,
      [e.dni, e.nombre, ANIO, dias, lic, ley, e.dt, estado, motivo]);
    if (estado === 'pendiente') work.push(`${e.dni};${ANIO};${dias};${lic}`);
  }
  const wl = path.join(DIR, 'worklist.csv');
  fs.writeFileSync(wl, 'dni;anio;dias;licencia\n' + work.join('\n') + (work.length ? '\n' : ''));
  console.log(`\nCola: pendientes=${pend} omitidos=${omit} ya-cargados=${dup}`);
  console.log(`worklist.csv: ${work.length} filas -> ${wl}`);
  await cn.end();
}

async function dbConn() {
  return mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1', port: +(env.DB_PORT || 3306),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'personalv5',
  });
}

function writeCfg({ dry, one, login }) {
  const cfg = `DO_LOGIN=${login ? 1 : 0}\nDRY_RUN=${dry ? 1 : 0}\nONLY_ONE=${one ? 1 : 0}\n`;
  fs.writeFileSync(path.join(DIR, 'robot.cfg'), cfg);
  console.log(`robot.cfg -> DO_LOGIN=${login ? 1 : 0} DRY_RUN=${dry ? 1 : 0} ONLY_ONE=${one ? 1 : 0}`);
}

function runRobot() {
  const au3 = path.join(DIR, 'robot_siape.au3');
  console.log('Ejecutando robot AutoIt...');
  const r = spawnSync(AUTOIT, [au3], { stdio: 'inherit' });
  if (r.error) throw new Error('No pude lanzar AutoIt: ' + r.error.message);
  console.log(`Robot termino (exit ${r.status}).`);
}

// Robot nuevo: Python + Java Access Bridge. Lee/verifica/guarda y marca la DB
// (cola_carga_stress + stress_cargados) por si mismo -> no usa robot.cfg ni CSV.
function runJab({ dry, dni, limit } = {}) {
  const py = path.join(DIR, '..', 'cargar_stress_jab.py');
  const args = [py];
  if (dry) args.push('--dry-run');
  if (dni) args.push('--dni', String(dni));
  if (limit) args.push('--limit', String(limit));
  console.log('Ejecutando robot JAB (Python)...', args.slice(1).join(' '));
  const r = spawnSync('python', args, { stdio: 'inherit' });
  if (r.error) throw new Error('No pude lanzar python: ' + r.error.message);
  console.log(`Robot JAB termino (exit ${r.status}).`);
}

async function reconcile() {
  const rf = path.join(DIR, 'robot_result.csv');
  if (!fs.existsSync(rf)) { console.log('Sin robot_result.csv (el robot no reporto nada).'); return; }
  const cn = await dbConn();
  let ok = 0, dry = 0, err = 0;
  for (const raw of fs.readFileSync(rf, 'utf8').split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const [dniS, estado] = l.split(';');
    const dni = parseInt(dniS); if (!dni) continue;
    if (estado === 'ok') {
      const [[row]] = await cn.query(`SELECT dias, licencia FROM cola_carga_stress WHERE dni=? AND anio=?`, [dni, ANIO]);
      await cn.query(
        `INSERT INTO stress_cargados (dni,anio,dias,licencia) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE dias=VALUES(dias), licencia=VALUES(licencia), cargado_at=CURRENT_TIMESTAMP`,
        [dni, ANIO, row?.dias ?? null, row?.licencia ?? null]);
      await cn.query(`UPDATE cola_carga_stress SET estado='cargado', motivo='cargado por robot' WHERE dni=? AND anio=?`, [dni, ANIO]);
      ok++;
    } else if (estado === 'error') {
      await cn.query(`UPDATE cola_carga_stress SET estado='error', motivo='SIAPE rechazo (ya existe / error) - ver shot' WHERE dni=? AND anio=?`, [dni, ANIO]);
      err++;
    } else if (estado === 'dry') {
      dry++;
    }
  }
  console.log(`Reconcile: guardados=${ok} (ledger), errores=${err}, dry=${dry}`);
  await cn.end();
}

function hasFlag(f) { return process.argv.includes(f); }

function trimWorklist(n) {
  const wl = path.join(DIR, 'worklist.csv');
  if (!fs.existsSync(wl)) return;
  const lines = fs.readFileSync(wl, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = lines[0];
  const rows = lines.slice(1, 1 + n);
  fs.writeFileSync(wl, header + '\n' + rows.join('\n') + (rows.length ? '\n' : ''));
  console.log(`Worklist recortado a ${rows.length} fila(s) (--limit ${n})`);
}

function flagVal(f) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; }

async function main() {
  const cmd = process.argv[2] || '--all';
  const dry = hasFlag('--dry');
  const one = hasFlag('--one');
  const login = !hasFlag('--no-login');
  const dniFilter = flagVal('--dni') ? parseInt(flagVal('--dni')) : null;
  const force = hasFlag('--force');
  const limit = flagVal('--limit') ? parseInt(flagVal('--limit')) : (one ? 1 : null);
  const autoit = hasFlag('--autoit');   // escape hatch al robot viejo
  if (cmd === '--build') { await build(dniFilter, force); if (limit) trimWorklist(limit); return; }
  if (cmd === '--reconcile') { await reconcile(); return; }
  if (cmd === '--run') {
    if (autoit) { if (limit) trimWorklist(limit); writeCfg({ dry, one, login }); runRobot(); await reconcile(); }
    else { runJab({ dry, dni: dniFilter, limit }); }
    return;
  }
  if (cmd === '--all') {
    await build(dniFilter, force);
    if (autoit) { if (limit) trimWorklist(limit); writeCfg({ dry, one, login }); runRobot(); await reconcile(); }
    else { runJab({ dry, dni: dniFilter, limit }); }
    return;
  }
  console.error('uso: node cargar_stress.mjs [--build | --run | --reconcile | --all] [--dry] [--one] [--limit N] [--dni N] [--autoit]');
  process.exit(1);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
