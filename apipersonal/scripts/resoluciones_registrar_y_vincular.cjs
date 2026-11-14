/**
 * Resoluciones ↔ carpeta RESOLUCIONES Y VARIOS.
 *
 *  1) Registra en tblarchivos (dni=1) los archivos de la carpeta principal que todavía
 *     no tienen fila (nunca borra ni pisa filas existentes).
 *  2) Rellena resoluciones.archivo_id donde está vacío, comparando por NÚMEROS
 *     (cualquier formato: RESOC-2026-997-GDEBA-SGG ↔ RESOC-2026-997.pdf,
 *     1839/2006 ↔ 11112-1839-06.pdf, etc.). Si hay más de un candidato igual de bueno,
 *     NO vincula (queda para elegir a mano en el visor).
 *
 *  Robot diario: robots_config 'resoluciones_vincular' (mig 125) → run_robot.py corre
 *  `node resoluciones_registrar_y_vincular.cjs --apply` (exit 0 = ok).
 *
 *  Uso:  node scripts/resoluciones_registrar_y_vincular.cjs           (simulación)
 *        node scripts/resoluciones_registrar_y_vincular.cjs --apply   (graba)
 *
 *  La lógica de comparación es la misma que usa el visor en
 *  apifront/src/pages/ResolucionesPage/index.tsx (matchResolucionArchivo).
 */
// .env de apipersonal aunque se corra desde scripts\ (run_robot.py); no pisa variables ya heredadas
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const CARPETA_LOCAL = process.env.RESOLUCIONES_DIR || 'D:\\G\\RESOLUCIONES Y VARIOS';
const RUTA_DB = '\\\\192.168.0.21\\g\\RESOLUCIONES Y VARIOS';
const EXT_OK = /\.(pdf|jpe?g|png|tiff?|bmp|gif|docx?)$/i;

// ─── Matcher (misma lógica que el front) ─────────────────────────────────────
const sinExt = (s) => String(s ?? '').replace(/\.+[a-z0-9]{2,5}$/i, '');
// Parte "número" del nombre: une "RESO 752" / "RESOC- 2026" y corta en el primer espacio
// (lo que sigue es apellido, " 2", " no usar", etc.).
const principal = (s) => sinExt(s).trim().replace(/\s*-\s*/g, '-').replace(/^([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+(?=\d)/, '$1-').split(/\s+/)[0] || '';
const ANIO_MAX = new Date().getFullYear() + 1;
// Grupos de dígitos; UN solo grupo se toma como año (el mayor de 4 cifras entre 1960 y el año que viene)
// y se lleva a 2 cifras, así "2006" == "06".
const grupos = (s) => {
  const gs = String(s).match(/\d+/g) || [];
  let iAnio = -1;
  gs.forEach((g, i) => { const n = +g; if (g.length === 4 && n >= 1960 && n <= ANIO_MAX && (iAnio < 0 || n > +gs[iAnio])) iAnio = i; });
  return gs.map((g, i) => (i === iAnio ? +g % 100 : +g));
};
const prefijo = (s) => (principal(s).match(/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+/) || [''])[0].toUpperCase();
const familia = (p) => {
  if (!p) return '';
  if (/^RES/.test(p)) return 'RESO';
  if (/^DEC/.test(p)) return 'DECRETO';
  if (/^DI/.test(p)) return 'DISPO';
  return p;
};
const ordenado = (a) => [...a].sort((x, y) => x - y).join(',');
const mismoMultiset = (a, b) => a.length === b.length && ordenado(a) === ordenado(b);
const contiene = (grande, chico) => {
  const resto = [...grande];
  for (const n of chico) { const i = resto.indexOf(n); if (i < 0) return false; resto.splice(i, 1); }
  return true;
};
const normTxt = (s) => sinExt(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function puntaje(numeroRes, fechaRes, nombreArchivo, apellido = '') {
  let R = grupos(principal(numeroRes));
  if (!R.length) return 0;
  if (R.length === 1 && fechaRes) R = [...R, Number(String(fechaRes instanceof Date ? fechaRes.toISOString() : fechaRes).slice(0, 4)) % 100];
  const F = grupos(principal(nombreArchivo));
  if (!F.length) return 0;
  const preR = prefijo(numeroRes); const preF = prefijo(nombreArchivo);
  const famR = familia(preR); const famF = familia(preF);
  if (famR && famF && famR !== famF) return 0;
  let p = 0;
  if (mismoMultiset(R, F)) p = 100;
  else if (!preR && R.length >= 2 && F.length > R.length && contiene(F, R)) p = 50;
  else return 0;
  if (normTxt(numeroRes) && normTxt(numeroRes) === normTxt(nombreArchivo)) p += 20;      // mismo nombre exacto
  if (preR && preR === preF) p += 10; else if (famR && famR === famF) p += 5;
  const restoArchivo = normTxt(sinExt(nombreArchivo).trim().split(/\s+/).slice(1).join(' '));
  const ape = normTxt(String(apellido).split(/[\s,]+/)[0] || '');
  if (ape.length >= 3 && restoArchivo.includes(ape)) p += 15;                           // apellido del agente
  else if (!restoArchivo) p += 3;                                                       // sin sufijo
  const lit = (s) => (principal(s).match(/\d+/g) || []).join('-');
  if (lit(numeroRes) === lit(nombreArchivo)) p += 2;                                    // mismo formato de año
  if (/no usar|blanco/i.test(nombreArchivo)) p -= 30;
  return p;
}
function matchResolucionArchivo(r, archivos, apellido = '') {
  const scored = archivos
    .map((a) => ({ a, p: puntaje(r.numero, r.fecha, a.nombre_archivo_original || a.nombre || '', apellido) }))
    .filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p);
  if (!scored.length) return { archivo: null, candidatos: [] };
  const top = scored.filter((x) => x.p === scored[0].p);
  return { archivo: top.length === 1 ? top[0].a : null, candidatos: scored.slice(0, 10).map((x) => x.a) };
}

// ─── Parseo de nombre → tipo/numero/anio (solo informativo) ──────────────────
function parsear(nombre) {
  const base = principal(nombre);
  const pre = prefijo(nombre);
  const nums = String(base).match(/\d+/g) || [];
  if (!pre && nums.length >= 3) return { tipo: nums[0], numero: nums[1], anio: Number(nums[2]) };
  const iAnio = nums.findIndex((g) => g.length === 4 && +g >= 1950 && +g <= 2099);
  let anio = null; let numero = null;
  if (iAnio >= 0) { anio = Number(nums[iAnio]); numero = nums.find((_, i) => i !== iAnio) ?? null; }
  else if (nums.length >= 2) { numero = nums[0]; anio = Number(nums[nums.length - 1]); }
  else numero = nums[0] ?? null;
  return { tipo: pre || null, numero, anio: Number.isFinite(anio) ? anio : null };
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  console.log(`DB ${process.env.DB_NAME} · ${APPLY ? 'GRABANDO' : 'SIMULACIÓN'}`);

  // 1) Registrar faltantes
  const [existentes] = await c.query(
    "SELECT id, nombre_archivo_original FROM tblarchivos WHERE dni=1 AND ruta LIKE '%RESOLUCIONES Y VARIOS' AND deleted_at IS NULL");
  const ya = new Set(existentes.map((e) => String(e.nombre_archivo_original || '').toLowerCase()));
  const archivosCarpeta = fs.readdirSync(CARPETA_LOCAL, { withFileTypes: true })
    .filter((d) => d.isFile() && EXT_OK.test(d.name)).map((d) => d.name);
  const faltan = archivosCarpeta.filter((n) => !ya.has(n.toLowerCase()));
  console.log(`Carpeta: ${archivosCarpeta.length} archivos · ya en tabla: ${existentes.length} · faltan: ${faltan.length}`);
  if (APPLY && faltan.length) {
    const filas = faltan.map((n) => {
      const { tipo, numero, anio } = parsear(n);
      return [1, RUTA_DB, n, tipo ? String(tipo).slice(0, 50) : null, numero, anio, 1];
    });
    for (let i = 0; i < filas.length; i += 500) {
      await c.query('INSERT INTO tblarchivos (dni, ruta, nombre_archivo_original, tipo, numero, anio, procesada) VALUES ?', [filas.slice(i, i + 500)]);
    }
    console.log(`  insertados: ${filas.length}`);
  }

  // 2) Vincular resoluciones sin archivo_id
  const [generales] = await c.query(
    "SELECT id, nombre, nombre_archivo_original FROM tblarchivos WHERE dni=1 AND ruta LIKE '%RESOLUCIONES Y VARIOS' AND deleted_at IS NULL");
  const universo = APPLY ? generales : [
    ...generales,
    ...faltan.map((n, i) => ({ id: `nuevo${i}`, nombre_archivo_original: n })),
  ];
  const [res] = await c.query('SELECT r.id, r.dni, r.numero, r.fecha, p.apellido FROM resoluciones r LEFT JOIN personal p ON p.dni = r.dni WHERE r.archivo_id IS NULL AND r.numero IS NOT NULL AND r.numero <> ""');
  let ok = 0; let ambiguas = 0; let sin = 0; const muestra = []; const updates = []; const reporte = [];
  for (const r of res) {
    const m = matchResolucionArchivo(r, universo, r.apellido || '');
    const nom = (a) => a.nombre_archivo_original || a.nombre || '';
    if (m.archivo) {
      ok++; updates.push([m.archivo.id, r.id]);
      if (muestra.length < 25) muestra.push(`${r.numero}  →  ${nom(m.archivo)}`);
      reporte.push(['VINCULA', r.id, r.numero, puntaje(r.numero, r.fecha, nom(m.archivo), r.apellido || ''), nom(m.archivo)]);
    } else if (m.candidatos.length) {
      ambiguas++;
      reporte.push(['AMBIGUA', r.id, r.numero, puntaje(r.numero, r.fecha, nom(m.candidatos[0]), r.apellido || ''), m.candidatos.slice(0, 4).map(nom).join(' | ')]);
    } else { sin++; reporte.push(['SIN', r.id, r.numero, 0, '']); }
  }
  const repArg = process.argv.find((a) => a.startsWith('--report='));
  if (repArg) {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lineas = ['estado;res_id;numero;puntaje;archivo', ...reporte.map((f) => f.map(q).join(';'))];
    fs.writeFileSync(repArg.slice(9), String.fromCharCode(0xFEFF) + lineas.join(String.fromCharCode(13, 10)), 'utf8');
    console.log(`Reporte: ${repArg.slice(9)}`);
  }
  console.log(`Resoluciones sin archivo: ${res.length} · se vinculan: ${ok} · ambiguas (elegir a mano): ${ambiguas} · sin candidato: ${sin}`);
  muestra.forEach((l) => console.log('   ' + l));
  if (APPLY) {
    for (const [aid, rid] of updates) await c.query('UPDATE resoluciones SET archivo_id=? WHERE id=? AND archivo_id IS NULL', [aid, rid]);
    console.log(`  vinculadas: ${updates.length}`);
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
