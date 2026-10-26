// Carga la hoja 13 del Legajo Personal (9) Domicilio → tabla legajo_domicilios) desde
// D:\G\DIRECCIONES INTRANET (planillas "Direcciones ..." bajadas de la Intranet del Ministerio).
// Solo agentes de `personal` que NO tienen ningún domicilio cargado en legajo_domicilios (no pisa nada).
// Si un DNI está en varias planillas, vale la de FECHA MODIFICACION más nueva.
// El partido sale de `localidades` cuando la localidad coincide por nombre. Los códigos de
// partido/localidad del formulario quedan vacíos (los de la tabla son INDEC largos, no los del Ministerio).
//   node scripts/legajo_domicilios_desde_intranet.mjs            (dry-run)
//   node scripts/legajo_domicilios_desde_intranet.mjs --apply
import dotenv from 'dotenv'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx'; import mysql from 'mysql2/promise';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const APPLY = process.argv.includes('--apply');
const DIR = process.env.ART_DIRECCIONES_INTRANET_DIR?.trim() || 'D:/G/DIRECCIONES INTRANET';
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const txt = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (t) => txt(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
// La columna TELEFONOS del hospital trae el teléfono de la institución, no el del agente
const TEL_INSTITUCION = /422232/;

const fechaDe = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = txt(v); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

const intra = new Map();
for (const f of fs.readdirSync(DIR).filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))) {
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, f)), { cellDates: true });
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })) {
    const dni = Number(dig(r['NRO DOCUMENTO']));
    if (!dni || !txt(r.CALLE)) continue;
    const fecha = fechaDe(r['FECHA MODIFICACION']);
    const prev = intra.get(dni);
    if (!prev || (fecha ?? '') > (prev.fecha ?? '')) intra.set(dni, { ...r, fecha });
  }
}

const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
  const [locs] = await db.query("SELECT localidad_nombre, municipio_nombre, provincia_id FROM localidades WHERE deleted_at IS NULL AND provincia_id IN ('6','2')");
  const locPorNombre = new Map();
  for (const l of locs) { const k = norm(String(l.localidad_nombre).replace(/¥/g, 'N')); if (!locPorNombre.has(k) || l.provincia_id === '6') locPorNombre.set(k, l); }

  const [rows] = await db.query(`
    SELECT p.dni, p.apellido FROM personal p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM legajo_domicilios d WHERE d.dni = p.dni AND d.deleted_at IS NULL)`);
  let cargados = 0, sinPartido = 0; const ejemplos = [];
  for (const p of rows) {
    const r = intra.get(Number(p.dni));
    if (!r) continue;
    const piso = txt(r.PISO), depto = txt(r.DEPARTAMENTO), e1 = txt(r['ENTRE CALLE 1']), e2 = txt(r['ENTRE CALLE 2']);
    const calle = [
      [txt(r.CALLE), txt(r.NUMERO)].filter(Boolean).join(' '),
      piso && `Piso ${piso}`, depto && `Dto ${depto}`,
      e1 && e2 ? `e/ ${e1} y ${e2}` : (e1 || e2) && `e/ ${e1 || e2}`,
    ].filter(Boolean).join(', ');
    const cp = txt(r['CODIGO POSTAL']);
    const l = locPorNombre.get(norm(r.LOCALIDAD));
    if (!l) sinPartido++;
    const tel = txt(r.TELEFONOS);
    const fila = {
      dni: p.dni,
      fecha: r.fecha,
      calle_numero: calle.slice(0, 250),
      telefono: tel && !TEL_INSTITUCION.test(tel) ? tel.slice(0, 60) : null,
      partido: l?.municipio_nombre ?? null,
      localidad: [txt(r.LOCALIDAD), cp && `CP ${cp}`].filter(Boolean).join(' — ').slice(0, 150) || null,
    };
    if (ejemplos.length < 3) ejemplos.push(fila);
    if (APPLY) await db.query('INSERT INTO legajo_domicilios SET ?', [fila]);
    cargados++;
  }
  console.log(`${APPLY ? 'Cargados' : '[dry-run] Se cargarían'}: ${cargados} domicilios (${sinPartido} sin partido: localidad no encontrada en la tabla).`);
  console.log('Ejemplos:', ejemplos);
} finally {
  await db.end();
}
