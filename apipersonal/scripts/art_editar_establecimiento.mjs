// art_editar_establecimiento.mjs
// Script SEPARADO (no toca provincia_art_alta_trabajador.mjs).
// Para trabajadores YA cargados en ART pero en el ESTABLECIMIENTO equivocado: los pasa a Catán
// (488242) = eliminar el/los establecimiento(s) viejos + agregar Catán, en la página de
// modificación del trabajador. El domicilio NO se toca (ART no deja editarlo por web).
//
// Uso:
//   node scripts/art_editar_establecimiento.mjs --cuil 20-12580743-8            (dry-run, 1 agente)
//   node scripts/art_editar_establecimiento.mjs --excel D:\G\comparacion\lista.xlsx  (dry-run, lote)
//   ...agregar --apply para EJECUTAR de verdad (destructivo).
//   node scripts/art_editar_establecimiento.mjs --pendientes --apply
//        -> reprocesa de la tabla art_control_establecimiento los ERROR / PARCIAL / REINTENTAR
// Con --apply cada agente queda anotado en la tabla art_control_establecimiento (1 fila por DNI,
// FK a personal): es lo que muestra la pestaña "Establecimiento en ART" de la página Carga de ART.
// Opcionales: --estab 488242 (destino), --limit N.
// Env: ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS,
//      ART_COMPARACION_DIR (salida; default D:\G\comparacion).

import dotenv from 'dotenv';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n} en .env`); return v; };
const flag = (n, f = false) => { const r = process.env[n]; if (r == null || r === '') return f; return ['1', 'true', 'yes', 'si', 'on'].includes(String(r).trim().toLowerCase()); };

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = has('--apply');
// --quitar <estab>: modo inverso. Saca ese establecimiento SOLO si el trabajador tiene al menos otro
// (nunca lo deja sin establecimiento). Ej: personal externo cargado en 3 hospitales a la vez.
const QUITAR = val('--quitar') ? String(val('--quitar')).replace(/\D/g, '') : null;
const ESTAB_DESTINO = String(val('--estab', '488242')).replace(/\D/g, '');
const ESTAB_LABEL_HINT = opt('ART_ESTAB_DESTINO_HINT', 'CATAN KM.32');
const LIMIT = Number(val('--limit', '0')) || 0;
const OUT_DIR = opt('ART_COMPARACION_DIR', 'D:/G/comparacion');
const CAPTURE = path.join(appRoot, 'logs', 'art_capture');
const GRID = 'https://www.provinciart.com.ar/modules/usuarios_registrados/clientes/nomina_de_trabajadores/index_busqueda.php';

function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
async function clickVC(page, loc, label) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); if (!b) throw new Error(`No ubico ${label}`); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }
const fmtCuil = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(c || ''); };

// ── Entradas: CUILs a procesar ─────────────────────────────────────────────
// ── Tabla de control (art_control_establecimiento) ─────────────────────────
const dig = (s) => String(s ?? '').replace(/\D/g, '');
let db = null;
const dniPorCuil = new Map();
const fechaIngresoPorDni = new Map();   // dd/mm/aaaa (ART pide "F. Ingreso Empresa" para poder GUARDAR)
const localidadPorDni = new Map();      // localidad cargada en personal (si hay)
const localidadPorCpDb = new Map();     // CP -> localidad más frecuente en personal
const nacimientoPorDni = new Map();     // dd/mm/aaaa desde personal
// Domicilio declarado en la Intranet del Ministerio (D:\G\DIRECCIONES INTRANET): DNI -> {calle,numero,localidad,cp}
const INTRANET_DIR = opt('ART_DIRECCIONES_INTRANET_DIR', 'D:/G/DIRECCIONES INTRANET');
const domicilioIntranet = new Map();
function cargarDomiciliosIntranet() {
  let archivos = [];
  try { archivos = fs.readdirSync(INTRANET_DIR).filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$')); } catch { return; }
  for (const f of archivos) {
    try {
      const wb = XLSX.read(fs.readFileSync(path.join(INTRANET_DIR, f)));
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })) {
        const dni = Number(dig(r['NRO DOCUMENTO']));
        if (!dni || domicilioIntranet.has(dni)) continue;
        domicilioIntranet.set(dni, {
          calle: String(r.CALLE || '').trim(), numero: dig(r.NUMERO),
          localidad: String(r.LOCALIDAD || '').trim().toUpperCase(), cp: dig(r['CODIGO POSTAL']),
        });
      }
    } catch (e) { console.log(`   (no pude leer ${f}: ${e?.message || e})`); }
  }
}

// CP -> localidad ART (zona del hospital). ART valida CP contra localidad: si no corresponde,
// rechaza el GUARDAR y no queda nada cambiado.
const CP_LOCALIDAD = {
  1751: 'LA TABLADA', 1752: 'LOMAS DEL MIRADOR', 1753: 'VILLA LUZURIAGA', 1754: 'SAN JUSTO',
  1755: 'RAFAEL CASTILLO', 1757: 'GREGORIO DE LAFERRERE', 1759: 'GONZALEZ CATAN', 1761: 'PONTEVEDRA',
  1763: 'VIRREY DEL PINO', 1765: 'ISIDRO CASANOVA', 1766: 'LA TABLADA', 1768: 'CIUDAD MADERO',
  1770: 'TAPIALES', 1772: 'VILLA CELINA', 1773: 'INGENIERO BUDGE', 1774: 'ALDO BONZI', 1778: 'CIUDAD EVITA',
  1702: 'CIUDADELA', 1704: 'RAMOS MEJIA', 1706: 'HAEDO', 1708: 'MORON', 1712: 'CASTELAR', 1713: 'PARQUE SAN MARTIN',
  1714: 'ITUZAINGO', 1718: 'SAN ANTONIO DE PADUA', 1722: 'MERLO', 1727: 'MARCOS PAZ', 1744: 'MORENO',
  1746: 'FRANCISCO ALVAREZ', 1804: 'EZEIZA', 1812: 'CARLOS SPEGAZZINI', 1814: 'CAÑUELAS',
  1832: 'LOMAS DE ZAMORA', 1836: 'LLAVALLOL', 1842: 'MONTE GRANDE',
};

async function abrirDb() {
  db = await mysql.createConnection({
    host: opt('DB_HOST', '127.0.0.1'), port: Number(opt('DB_PORT', '3306')), user: opt('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '', database: opt('DB_NAME', 'personalv5'), dateStrings: true,
  });
  await db.query(`
    CREATE TABLE IF NOT EXISTS art_control_establecimiento (
      dni INT NOT NULL,
      cuil VARCHAR(13) NOT NULL,
      trabajador_id INT NULL COMMENT 'id del trabajador en ProvinciART',
      establecimiento_destino VARCHAR(10) NOT NULL,
      establecimientos_antes VARCHAR(600) NULL,
      accion VARCHAR(200) NULL,
      estado VARCHAR(20) NOT NULL COMMENT 'OK / YA_OK / PARCIAL / ERROR / NO_EN_ART / REINTENTAR',
      detalle VARCHAR(500) NULL,
      intentos INT NOT NULL DEFAULT 0,
      ultimo_intento DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (dni),
      KEY idx_art_control_establecimiento__estado (estado),
      CONSTRAINT fk_art_control_establecimiento__personal FOREIGN KEY (dni) REFERENCES personal (dni) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [rows] = await db.query("SELECT dni, cuil FROM personal WHERE cuil IS NOT NULL AND cuil <> ''");
  for (const r of rows) if (dig(r.cuil).length === 11) dniPorCuil.set(dig(r.cuil), r.dni);
  // ingreso real al hospital: la más vieja válida (fuera la centinela 01/11/1111)
  const [fis] = await db.query(
    "SELECT dni, MIN(fecha_ingreso) AS fi FROM personaldetalle WHERE fecha_ingreso > '1900-01-01' GROUP BY dni");
  for (const r of fis) {
    const m = String(r.fi || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) fechaIngresoPorDni.set(Number(r.dni), `${m[3]}/${m[2]}/${m[1]}`);
  }
  cargarDomiciliosIntranet();
  const [nacs] = await db.query("SELECT dni, DATE_FORMAT(fecha_nacimiento, '%d/%m/%Y') AS fn FROM personal WHERE fecha_nacimiento > '1900-01-01'");
  for (const r of nacs) nacimientoPorDni.set(Number(r.dni), r.fn);
  const [locs] = await db.query(`
    SELECT p.dni, REGEXP_REPLACE(COALESCE(p.cp,''),'[^0-9]','') AS cp, UPPER(l.localidad_nombre) AS loc
      FROM personal p JOIN localidades l ON l.id = p.localidad_id WHERE l.localidad_nombre IS NOT NULL`);
  const cuenta = new Map();
  for (const r of locs) {
    localidadPorDni.set(Number(r.dni), r.loc);
    if (r.cp) { const k = `${r.cp}|${r.loc}`; cuenta.set(k, (cuenta.get(k) || 0) + 1); }
  }
  const mejor = new Map();
  for (const [k, n] of cuenta) { const [cp, loc] = k.split('|'); if (!mejor.has(cp) || mejor.get(cp).n < n) mejor.set(cp, { loc, n }); }
  for (const [cp, { loc }] of mejor) localidadPorCpDb.set(cp, loc);
}

// ART rechaza GUARDAR en silencio si el domicilio no tiene Provincia/Localidad (fichas viejas
// con solo calle/número/CP). Se habilita la edición del domicilio y se elige BUENOS AIRES + la
// localidad: la de personal, si no la del CP. Calle/número/CP se conservan. Decisión 30/09/2026.
async function completarDomicilio(page, cuil) {
  const est = await page.evaluate(() => ({
    prov: document.getElementById('cbProvincia')?.value ?? '',
    loc: document.getElementById('cbLocalidad')?.value ?? '',
    cp: (document.getElementById('txtCPostal')?.value ?? '').replace(/\D/g, ''),
    calle: document.getElementById('txtDireccion')?.value ?? '',
    altura: document.getElementById('txtAltura')?.value ?? '',
  }));
  if (est.loc && est.prov && est.prov !== '-1') return null;
  const dni = dniPorCuil.get(dig(cuil));
  const intra = domicilioIntranet.get(dni);
  // Si ART no tiene CP/calle/número, se usan los de la Intranet (mismo domicilio que la localidad).
  const cp = est.cp || intra?.cp || '';
  const calle = est.calle || intra?.calle || '';
  const altura = est.altura || intra?.numero || '';
  // CABA: ART usa "CAPITAL FEDERAL" en Provincia y en Localidad (igual que el alta).
  const provArt = await page.evaluate(() => { const e = document.getElementById('cbProvincia'); return e?.options[e.selectedIndex]?.text || ''; });
  const cpN = Number(String(cp).slice(0, 4));
  const esCaba = /CAPITAL FEDERAL/i.test(provArt) || /^(CABA|C\.A\.B\.A\.|CAPITAL FEDERAL|CIUDAD AUTONOMA)/i.test(intra?.localidad || '')
    || (cpN >= 1000 && cpN <= 1499);
  const provincia = esCaba ? 'CAPITAL FEDERAL' : 'BUENOS AIRES';
  const candidatas = esCaba ? ['CAPITAL FEDERAL']
    : [localidadPorDni.get(dni), (!est.cp || est.cp === intra?.cp) ? intra?.localidad : null, CP_LOCALIDAD[cp], localidadPorCpDb.get(cp)].filter(Boolean);
  if (!candidatas.length) throw new Error(`ART no tiene localidad y no sé cuál corresponde al CP ${cp || '(vacío)'}`);
  const hab = page.locator('#btnHabilitarDomicilio');
  if (await hab.isVisible({ timeout: 1500 }).catch(() => false)) { await hab.click({ timeout: 8000 }); await page.waitForTimeout(1500); }
  await page.selectOption('#cbProvincia', { label: provincia });
  // Capital trae UNA sola opción (CAPITAL FEDERAL), a veces sin placeholder: se espera una opción con valor.
  await page.waitForFunction(() => [...(document.getElementById('cbLocalidad')?.options || [])].some((o) => o.value && o.value !== '-1'), null, { timeout: 15000 })
    .catch(() => { throw new Error('No cargó el combo de localidades'); });
  const elegida = await page.evaluate((cands) => {
    const el = document.getElementById('cbLocalidad');
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    for (const c of cands) {
      const o = [...el.options].find((x) => norm(x.text) === norm(c));
      if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); return o.text; }
    }
    return null;
  }, candidatas);
  if (!elegida) throw new Error(`ART no tiene la localidad ${candidatas.join(' / ')} (CP ${est.cp})`);
  await page.waitForTimeout(1500);
  await dismissModal(page);
  // Si al cambiar la localidad se vaciaron calle/altura/CP, se reponen los que tenía ART.
  if (altura && !(await page.inputValue('#txtAltura').catch(() => ''))) await page.fill('#txtAltura', altura).catch(() => {});
  if (cp && !(await page.inputValue('#txtCPostal').catch(() => ''))) await page.fill('#txtCPostal', cp).catch(() => {});
  const calleAhora = await page.evaluate(() => document.getElementById('txtDireccion')?.value ?? '');
  if (calle && !calleAhora) {
    await page.locator('#btnNoFoundStreet').click({ timeout: 8000 }).catch(() => {});
    await dismissModal(page);
    await page.waitForTimeout(700);
    await page.locator('xpath=//*[normalize-space(.)="Calle"]/following::input[not(@type="hidden")][1]').fill(calle, { timeout: 8000 }).catch(() => {});
  }
  await dismissModal(page);
  return elegida;
}

// F. de Nacimiento es obligatoria: si ART la tiene vacía se completa con la de personal.
async function completarFechaNacimiento(page, cuil) {
  const actual = (await page.inputValue('#fechaNacimiento').catch(() => 'x')).trim();
  if (actual) return null;
  const fn = nacimientoPorDni.get(dniPorCuil.get(dig(cuil)));
  if (!fn) throw new Error('ART no tiene F. de Nacimiento y personal tampoco');
  await page.evaluate((v) => {
    const e = document.getElementById('fechaNacimiento');
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }, fn);
  if ((await page.inputValue('#fechaNacimiento')).trim() !== fn) await page.fill('#fechaNacimiento', fn);
  return fn;
}

// Completa lo que ART exige (localidad/domicilio, F. nac, F. ingreso), aprieta GUARDAR y, si ART
// marca CP que no corresponde, lo corrige y guarda de nuevo. Se usa en los DOS guardados: leer la
// ficha recarga la página y se pierde lo completado (era la causa de los PARCIAL).
async function prepararYGuardar(page, cuil, row) {
  // En modo --quitar (personal externo) no tenemos su domicilio: si no se puede completar se intenta
  // guardar igual y se informa lo que marque ART.
  const locPuesta = QUITAR
    ? await completarDomicilio(page, cuil).catch((e) => { console.log(`   (domicilio: ${e.message})`); return null; })
    : await completarDomicilio(page, cuil);
  if (locPuesta) { row.accion = `${row.accion}; localidad ${locPuesta}`.trim(); console.log(`   completé localidad: ${locPuesta}`); }
  const fnPuesta = await completarFechaNacimiento(page, cuil);
  if (fnPuesta) { row.accion = `${row.accion}; F. nac ${fnPuesta}`.trim(); console.log(`   completé F. de Nacimiento: ${fnPuesta}`); }
  const fiPuesta = await completarFechaIngreso(page, cuil);
  if (fiPuesta) { row.accion = `${row.accion}; F. ingreso ${fiPuesta}`.trim(); console.log(`   completé F. Ingreso Empresa: ${fiPuesta}`); }
  await page.locator('#btnGuardar, input[value="GUARDAR" i]').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // Mensajes de validación visibles (ART rechaza en silencio, sin cartel): se guardan para el detalle.
  const erroresArt = await page.evaluate(() => {
    const out = new Set();
    for (const n of document.querySelectorAll('.inputError, .input_textError, [class*="error" i], [style*="red"]')) {
      const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
      const r = n.getBoundingClientRect();
      if (t && t.length < 200 && r.width > 0 && r.height > 0) out.add(t);
    }
    return [...out].slice(0, 6).join(' | ');
  }).catch(() => '');
  if (erroresArt) console.log(`   ART marca: ${erroresArt}`);
  // CP que no corresponde a la calle/localidad: se pone el de la Intranet (si es otro) o "No sé mi CP".
  if (/c[oó]digo postal no corresponde/i.test(erroresArt)) {
    const cpArt = (await page.inputValue('#txtCPostal').catch(() => '')).replace(/\D/g, '');
    const cpIntra = domicilioIntranet.get(dniPorCuil.get(dig(cuil)))?.cp || '';
    const hab = page.locator('#btnHabilitarDomicilio');
    if (await hab.isVisible({ timeout: 1000 }).catch(() => false)) { await hab.click({ timeout: 8000 }); await page.waitForTimeout(1200); }
    if (cpIntra && cpIntra !== cpArt) {
      await page.fill('#txtCPostal', cpIntra).catch(() => {});
      row.accion = `${row.accion}; CP ${cpArt}->${cpIntra}`.trim(); console.log(`   corregí CP: ${cpArt} -> ${cpIntra}`);
    } else {
      await page.locator('button:has-text("No sé mi CP"), button:has-text("No se mi CP"), input[type="button"][value*="No s"], #btnNoSeCP').first().click({ timeout: 5000 }).catch(() => {});
      await dismissModal(page);
      row.accion = `${row.accion}; CP desconocido`.trim(); console.log('   CP: "No sé mi CP"');
    }
    await page.waitForTimeout(800);
    await page.locator('#btnGuardar, input[value="GUARDAR" i]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  return erroresArt;
}
async function dismissModal(page) {
  const modal = page.locator('#myModal');
  if (await modal.isVisible({ timeout: 800 }).catch(() => false)) {
    const ok = await modal.locator('button:has-text("ACEPTAR"), input[value="ACEPTAR"], button:has-text("Aceptar")').first()
      .click({ timeout: 2500 }).then(() => true).catch(() => false);
    if (!ok) await modal.locator('.close, [class*="close"]').first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

// ART rechaza GUARDAR ("Hay 1 error") si "F. Ingreso Empresa" (#fechaIngreso) está vacío.
// Si falta, se completa con la fecha de ingreso que tenemos en personal.
async function completarFechaIngreso(page, cuil) {
  const actual = (await page.inputValue('#fechaIngreso').catch(() => '')).trim();
  if (actual) return null;
  // ART solo acepta una F. Ingreso a ±2 meses de HOY: la fecha real (años atrás) la rechaza.
  // Misma regla que el alta (artIngresoDate en provincia_art_alta_trabajador.mjs): la real si es
  // del último mes, si no HOY (decisión RRHH 30/09/2026).
  const real = fechaIngresoPorDni.get(dniPorCuil.get(dig(cuil)));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const corte = new Date(hoy); corte.setMonth(corte.getMonth() - 1);
  const [d, m, y] = String(real || '').split('/').map(Number);
  const fReal = y ? new Date(y, m - 1, d) : null;
  const p = (n) => String(n).padStart(2, '0');
  const fi = fReal && fReal >= corte && fReal <= hoy ? real
    : `${p(hoy.getDate())}/${p(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
  await page.evaluate((v) => {
    const e = document.getElementById('fechaIngreso');
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }, fi);
  if ((await page.inputValue('#fechaIngreso')).trim() !== fi) await page.fill('#fechaIngreso', fi);
  if ((await page.inputValue('#fechaIngreso')).trim() !== fi) throw new Error(`No pude completar F. Ingreso Empresa (${fi})`);
  return fi;
}

// Anota el resultado de un agente (solo con --apply: el dry-run no toca la tabla).
async function anotar(row) {
  if (!db || !APPLY) return;
  const dni = dniPorCuil.get(dig(row.cuil)) ?? (/^\d{7,8}$/.test(dig(row.cuil)) ? Number(dig(row.cuil)) : null);
  if (!dni) { console.log(`   (sin DNI en personal para ${row.cuil}: no se anota en la tabla)`); return; }
  const esError = /^(ERROR|PARCIAL)/.test(row.estado);
  try {
    await db.query(`
      INSERT INTO art_control_establecimiento
        (dni, cuil, trabajador_id, establecimiento_destino, establecimientos_antes, accion, estado, detalle, intentos, ultimo_intento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE cuil = VALUES(cuil), trabajador_id = COALESCE(VALUES(trabajador_id), trabajador_id),
        establecimiento_destino = VALUES(establecimiento_destino),
        establecimientos_antes = COALESCE(VALUES(establecimientos_antes), establecimientos_antes),
        accion = VALUES(accion), estado = VALUES(estado), detalle = VALUES(detalle),
        intentos = intentos + 1, ultimo_intento = NOW()`,
      [dni, fmtCuil(row.cuil), row.trabajadorId ? Number(row.trabajadorId) : null, ESTAB_DESTINO,
        row.establecimiento_actual ? String(row.establecimiento_actual).slice(0, 600) : null,
        String(row.accion || '').slice(0, 200) || null,
        String(row.estado).startsWith('PARCIAL') ? 'PARCIAL' : String(row.estado).slice(0, 20),
        (esError ? String(row.detalle || row.estado) : null)?.slice(0, 500) ?? null]);
  } catch (e) { console.log(`   (no pude anotar en la tabla: ${e?.message || e})`); }
}

async function leerPendientesDb() {
  const [rows] = await db.query(
    "SELECT cuil FROM art_control_establecimiento WHERE estado IN ('ERROR','PARCIAL','REINTENTAR') ORDER BY ultimo_intento");
  const uniq = [...new Set(rows.map((r) => fmtCuil(r.cuil)).filter(Boolean))];
  return LIMIT ? uniq.slice(0, LIMIT) : uniq;
}

function leerEntradas() {
  const cuils = [];
  const single = val('--cuil');
  if (single) cuils.push(fmtCuil(single));
  const excel = val('--excel');
  if (excel) {
    const wb = XLSX.read(fs.readFileSync(excel));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    for (const r of rows) {
      const cuilCol = r.CUIL || r.Cuil || r.cuil;
      const dniCol = r.DNI || r.Dni || r.dni;
      if (cuilCol && String(cuilCol).replace(/\D/g, '').length === 11) cuils.push(fmtCuil(cuilCol));
      else if (dniCol) cuils.push(String(dniCol).replace(/\D/g, '')); // sin CUIL: buscamos por DNI igual sirve el buscador
    }
  }
  const uniq = [...new Set(cuils.filter(Boolean))];
  return LIMIT ? uniq.slice(0, LIMIT) : uniq;
}

async function login(page) {
  await page.goto(opt('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados'), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const lb = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")').first();
  if (await lb.isVisible({ timeout: 5000 }).catch(() => false)) {
    const li = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(page, li.nth(0), must('ART_PROVINCIA_USER'));
    await typeInto(page, li.nth(1), must('ART_PROVINCIA_PASSWORD'));
    await page.waitForTimeout(400); await clickVC(page, lb, 'Iniciar sesion');
    await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(1200);
}

// Busca por CUIL/DNI en la nómina y devuelve trabajadorId (o null).
async function buscarTrabajadorId(page, cuilOrDni) {
  await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const buscado = String(cuilOrDni).replace(/\D/g, '');
  // Sin CUIL NO se busca: con el campo vacío ART lista a TODOS y se tomaba al primero (otra persona).
  // Pasó el 30/09/2026: se movió a Catán a un trabajador ajeno (RACHID, id 2489602).
  if (buscado.length !== 11) return null;
  await typeInto(page, page.locator('#cuil'), cuilOrDni);
  const buscar = page.locator('input[type=submit][value*="BUSCAR" i], input[value*="BUSCAR" i], button:has-text("BUSCAR")').first();
  await clickVC(page, buscar, 'BUSCAR');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Solo vale la fila cuyo CUIL es el buscado: si la búsqueda no encuentra nada, la página puede
  // seguir mostrando el resultado anterior (y antes se tomaba ese id: falsos "ya en destino").
  return page.evaluate((buscado) => {
    for (const a of document.querySelectorAll('a[href*="modificacion-trabajador/"], [onclick*="modificacion-trabajador/"]')) {
      const m = (a.getAttribute('href') || a.getAttribute('onclick') || '').match(/modificacion-trabajador\/(\d+)/);
      const fila = a.closest('tr');
      if (m && fila && (fila.innerText || '').replace(/\D/g, '').includes(buscado)) return m[1];
    }
    return null;
  }, buscado);
}

// Lee la modificación: rl + establecimientos actuales (id + label).
async function leerEstablecimientos(page, tid) {
  await page.goto(`https://www.provinciart.com.ar/nomina-trabajadores/modificacion-trabajador/${tid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const meta = await page.evaluate(() => {
    const b = document.getElementById('altaEstablecimientos');
    const m = b && (b.getAttribute('onclick') || '').match(/buscarEstablecimiento\('?(\d+)'?\)/);
    const hidden = document.getElementById('establecimientos');
    return { rl: m ? m[1] : null, hidden: hidden ? hidden.value : null };
  });
  const fr = page.frames().find(f => /establecimientos\.php/i.test(f.url()));
  let lista = [];
  if (fr) lista = await fr.evaluate(() => Array.from(document.querySelectorAll('.btnQuitar')).map(btn => {
    const oc = btn.getAttribute('onclick') || '';
    const id = (oc.match(/[?&]id=(\d+)/) || [])[1] || null;
    const tr = btn.closest('tr'); const label = tr ? (tr.querySelector('td')?.innerText || '').replace(/\s+/g, ' ').trim() : '';
    return { id, label };
  }).filter(x => x.id));
  return { rl: meta.rl, hidden: meta.hidden, establecimientos: lista, page };
}

async function main() {
  await abrirDb();
  const cuils = has('--pendientes') ? await leerPendientesDb() : leerEntradas();
  if (!cuils.length) { console.log('Sin entradas. Usá --cuil <cuil>, --excel <archivo> o --pendientes.'); await db.end(); return; }
  await fsp.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await fsp.mkdir(CAPTURE, { recursive: true });
  const { chromium } = await import('playwright');
  const headless = flag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const ctx = await browser.newContext(headless ? { viewport: { width: 1400, height: 1100 } } : { viewport: null });
  const page = await ctx.newPage();
  // Carteles de ART (ej. validación al GUARDAR): se anotan en el log y en el detalle del error.
  let ultimoCartel = '';
  page.on('dialog', d => { ultimoCartel = d.message(); console.log(`   cartel ART: ${ultimoCartel}`); d.accept().catch(() => {}); });
  const resultados = [];
  try {
    await login(page);
    console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo lee)'} | destino establecimiento ${ESTAB_DESTINO} | ${cuils.length} agente(s)`);
    for (const cuil of cuils) {
      ultimoCartel = '';
      const row = { cuil, trabajadorId: null, establecimiento_actual: '', accion: '', estado: '' };
      try {
        const tid = await buscarTrabajadorId(page, cuil);
        if (!tid) { row.estado = 'NO_EN_ART'; row.accion = 'alta nueva (no editar)'; resultados.push(row); await anotar(row); console.log(`${cuil}: NO está en ART`); continue; }
        row.trabajadorId = tid;
        const { rl, establecimientos } = await leerEstablecimientos(page, tid);
        row.establecimiento_actual = establecimientos.map(e => `${e.id} ${e.label}`).join(' | ');
        const yaTiene = establecimientos.some(e => e.id === ESTAB_DESTINO);
        const otros = establecimientos.filter(e => e.id !== ESTAB_DESTINO);
        if (QUITAR) {
          const tiene = establecimientos.some(e => e.id === QUITAR);
          const resto = establecimientos.filter(e => e.id !== QUITAR);
          if (!tiene) { row.estado = 'NO_TIENE'; row.accion = 'ninguna'; resultados.push(row); console.log(`${cuil}: no tiene ${QUITAR}`); continue; }
          if (!resto.length) { row.estado = 'UNICO'; row.accion = `no se quita ${QUITAR} (es el único)`; resultados.push(row); console.log(`${cuil}: ${QUITAR} es su único establecimiento, no se toca`); continue; }
          row.accion = `quitar ${QUITAR} (quedan ${resto.map(e => e.id).join(',')})`;
          if (!APPLY) { row.estado = 'PLAN (dry-run)'; resultados.push(row); console.log(`${cuil}: PLAN -> ${row.accion}`); continue; }
          const frQ = page.frames().find(f => /establecimientos\.php/i.test(f.url()));
          if (!frQ) throw new Error('No encuentro la grilla de establecimientos para quitar');
          await frQ.locator(`#grid_col3_${QUITAR}`).click({ timeout: 8000 });
          await page.waitForTimeout(2500);
          await prepararYGuardar(page, cuil, row);
          const finQ = (await leerEstablecimientos(page, tid)).establecimientos;
          row.estado = !finQ.some(e => e.id === QUITAR) && finQ.length ? 'QUITADO' : `PARCIAL (${finQ.map(e => e.id).join(',')})`;
          row.establecimiento_actual = finQ.map(e => `${e.id} ${e.label}`).join(' | ');
          resultados.push(row); console.log(`${cuil}: ${row.estado} -> quedan ${finQ.map(e => e.id).join(',')}`); continue;
        }
        if (yaTiene && otros.length === 0) { row.estado = 'YA_OK'; row.accion = 'ninguna'; resultados.push(row); await anotar(row); console.log(`${cuil}: ya está SOLO en destino`); continue; }
        row.accion = `${yaTiene ? '' : `agregar ${ESTAB_DESTINO}; `}${otros.length ? `quitar ${otros.map(o => o.id).join(',')}` : ''}`.trim();
        if (!APPLY) { row.estado = 'PLAN (dry-run)'; resultados.push(row); console.log(`${cuil}: PLAN -> ${row.accion}`); continue; }
        // ── APPLY ──────────────────────────────────────────────────────────
        // 1) Agregar destino PRIMERO (para no dejar al trabajador sin establecimiento).
        if (!yaTiene) {
          // ART (sep/2026): el buscador ya no es un iframe agregar_establecimiento.php sino un
          // popup en la misma página (#dialogEstablecimiento, cargado por AJAX). Cada resultado
          // trae su botón Seleccionar con id grid_col3_<idEstablecimiento>.
          await page.locator('#altaEstablecimientos').click({ timeout: 8000 });
          const dlg = page.locator('#dialogEstablecimiento');
          await dlg.locator('#nombre').waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => { throw new Error('No se abrió el buscador de agregar'); });
          await dlg.locator('#nombre').fill(ESTAB_LABEL_HINT);
          await dlg.locator('input[type=submit], button[type=submit]').first().click({ timeout: 8000 });
          const pick = dlg.locator(`#grid_col3_${ESTAB_DESTINO}`);
          await pick.waitFor({ state: 'visible', timeout: 15000 })
            .catch(() => { throw new Error(`El buscador no devolvió el establecimiento ${ESTAB_DESTINO}`); });
          await pick.click({ timeout: 8000 });
          await page.waitForTimeout(2500);
        }
        // 2) Guardar (antes, F. Ingreso Empresa si ART la tiene vacía)
        const erroresArt = await prepararYGuardar(page, cuil, row);
        // 3) Releer para verificar que el destino quedó
        const rl2 = (await leerEstablecimientos(page, tid));
        const okDestino = rl2.establecimientos.some(e => e.id === ESTAB_DESTINO);
        if (!okDestino) {
          await page.screenshot({ path: path.join(CAPTURE, `editar_error_${String(cuil).replace(/\D/g, '')}_${stamp()}.png`), fullPage: true }).catch(() => {});
          throw new Error(`No se pudo agregar el destino; NO se elimina nada${ultimoCartel ? ` (ART: ${ultimoCartel})` : ''}${erroresArt ? ` [${erroresArt}]` : ''}`);
        }
        // 4) Recién ahora eliminar los viejos
        for (const o of rl2.establecimientos.filter(e => e.id !== ESTAB_DESTINO)) {
          // Con el boton de la grilla (no por request.get): la respuesta de eliminar_establecimiento
          // corre JS que actualiza el hidden #establecimientos del padre, que es lo que GUARDAR
          // manda. Por request.get el hidden seguia con el viejo y al guardar volvia (PARCIAL).
          const frE = page.frames().find(f => /establecimientos\.php/i.test(f.url()));
          if (!frE) throw new Error('No encuentro la grilla de establecimientos para quitar');
          await frE.locator(`#grid_col3_${o.id}`).click({ timeout: 8000 });
          await page.waitForTimeout(2500);
        }
        const hidden = await page.evaluate(() => document.getElementById('establecimientos')?.value ?? null);
        if (hidden && rl2.establecimientos.some(e => e.id !== ESTAB_DESTINO && hidden.split(',').includes(e.id))) {
          console.log(`   aviso: el hidden sigue con el viejo (${hidden})`);
        }
        await prepararYGuardar(page, cuil, row);
        const fin = (await leerEstablecimientos(page, tid)).establecimientos;
        row.estado = fin.length === 1 && fin[0].id === ESTAB_DESTINO ? 'OK' : `PARCIAL (${fin.map(e => e.id).join(',')})`;
        await page.screenshot({ path: path.join(CAPTURE, `editar_${String(cuil).replace(/\D/g, '')}_${stamp()}.png`), fullPage: true }).catch(() => {});
        console.log(`${cuil}: ${row.estado}`);
      } catch (e) {
        row.estado = 'ERROR'; row.detalle = (e?.message || String(e)).slice(0, 500);
        row.accion = row.accion || row.detalle.slice(0, 120);
        console.log(`${cuil}: ERROR ${e?.message || e}`);
      }
      resultados.push(row);
      if (!String(row.estado).startsWith('PLAN')) await anotar(row);
    }
  } finally {
    // salida a comparación
    const ws = XLSX.utils.json_to_sheet(resultados.map(r => ({ CUIL: r.cuil, TrabajadorId: r.trabajadorId, Establecimiento_actual: r.establecimiento_actual, Accion: r.accion, Estado: r.estado })));
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 70 }, { wch: 30 }, { wch: 16 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Editar establecimiento');
    const out = path.join(OUT_DIR, `art_editar_establecimiento_${APPLY ? 'APPLY' : 'DRYRUN'}_${stamp()}.xlsx`);
    try { XLSX.writeFile(wb, out); console.log(`\nResultado: ${out} (${resultados.length} filas)`); }
    catch (e) { const alt = path.join(CAPTURE, path.basename(out)); XLSX.writeFile(wb, alt); console.log(`\n(No pude escribir en ${OUT_DIR}) Resultado en: ${alt}`); }
    await browser.close();
    await db?.end().catch(() => {});
  }
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exitCode = 1; });
