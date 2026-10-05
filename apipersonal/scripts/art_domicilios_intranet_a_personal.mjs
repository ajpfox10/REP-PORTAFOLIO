// Completa el domicilio en `personal` desde D:\G\DIRECCIONES INTRANET (planillas de la Intranet del
// Ministerio) para los agentes que NO están en ART (art_control_establecimiento.estado='NO_EN_ART'),
// así el alta automática (provincia_art_alta_trabajador.mjs, domicilio DB-first) los puede cargar.
// Solo llena campos VACÍOS (no pisa nada). Respaldo del antes en logs/art/personal_domicilio_bkp_<ts>.json.
//   node scripts/art_domicilios_intranet_a_personal.mjs            (dry-run)
//   node scripts/art_domicilios_intranet_a_personal.mjs --apply
import dotenv from 'dotenv'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx'; import mysql from 'mysql2/promise';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const APPLY = process.argv.includes('--apply');
const DIR = process.env.ART_DIRECCIONES_INTRANET_DIR?.trim() || 'D:/G/DIRECCIONES INTRANET';
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const vacio = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '0';

const intra = new Map();
for (const f of fs.readdirSync(DIR).filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))) {
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, f)));
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })) {
    const dni = Number(dig(r['NRO DOCUMENTO']));
    if (dni && !intra.has(dni)) intra.set(dni, r);
  }
}

const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
  const [locs] = await db.query("SELECT id, localidad_nombre, provincia_id FROM localidades WHERE deleted_at IS NULL AND provincia_id IN ('6','2')");
  const locPorNombre = new Map();
  for (const l of locs) { const k = norm(String(l.localidad_nombre).replace(/¥/g, 'N')); if (!locPorNombre.has(k) || l.provincia_id === '6') locPorNombre.set(k, l); }
  // "CABA" / "CAPITAL FEDERAL" a secas -> CIUDAD DE BUENOS AIRES (provincia 2)
  const caba = locPorNombre.get('CIUDAD DE BUENOS AIRES');
  if (caba) for (const a of ['CABA', 'C.A.B.A.', 'CAPITAL FEDERAL', 'CAPITAL', 'CIUDAD AUTONOMA DE BUENOS AIRES']) if (!locPorNombre.has(a)) locPorNombre.set(a, caba);
  const [rows] = await db.query(`
    SELECT p.dni, p.apellido, p.nombre, p.domicilio, p.numerodomicilio, p.cp, p.piso, p.depto, p.localidad_id, p.provincia_id
      FROM art_control_establecimiento e JOIN personal p ON p.dni = e.dni WHERE e.estado = 'NO_EN_ART'`);
  const bkp = []; const sinIntranet = []; const sinLocalidad = []; let actualizados = 0;
  for (const p of rows) {
    const r = intra.get(Number(p.dni));
    if (!r) { sinIntranet.push(`${p.dni} ${p.apellido}`); continue; }
    const set = {};
    const calle = String(r.CALLE || '').trim(), nro = dig(r.NUMERO), cp = dig(r['CODIGO POSTAL']);
    const piso = dig(r.PISO), depto = String(r.DEPARTAMENTO || '').trim();
    if (vacio(p.domicilio) && calle) set.domicilio = calle.slice(0, 200);
    if (vacio(p.numerodomicilio) && nro) set.numerodomicilio = Number(nro.slice(0, 9));
    if (vacio(p.cp) && cp) set.cp = cp;
    if (vacio(p.piso) && piso) set.piso = Number(piso.slice(0, 4));
    if (vacio(p.depto) && depto) set.depto = depto.slice(0, 50);
    if (vacio(p.localidad_id) && r.LOCALIDAD) {
      const l = locPorNombre.get(norm(r.LOCALIDAD));
      if (l) { set.localidad_id = l.id; set.provincia_id = l.provincia_id; } else sinLocalidad.push(`${p.dni} ${p.apellido}: "${r.LOCALIDAD}"`);
    }
    if (!Object.keys(set).length) continue;
    bkp.push({ dni: p.dni, antes: Object.fromEntries(Object.keys(set).map(k => [k, p[k]])), despues: set });
    if (APPLY) await db.query('UPDATE personal SET ? WHERE dni = ?', [set, p.dni]);
    actualizados++;
  }
  if (APPLY && bkp.length) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    fs.mkdirSync(path.join(appRoot, 'logs', 'art'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'logs', 'art', `personal_domicilio_bkp_${ts}.json`), JSON.stringify(bkp, null, 1));
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} | NO_EN_ART: ${rows.length} | ${APPLY ? 'actualizados' : 'a actualizar'}: ${actualizados} | sin planilla Intranet: ${sinIntranet.length} | localidad sin match: ${sinLocalidad.length}`);
  if (sinLocalidad.length) console.log('Localidad sin match:\n  ' + sinLocalidad.join('\n  '));
} finally { await db.end(); }
