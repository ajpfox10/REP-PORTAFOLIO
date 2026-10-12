// art_baja_trabajador.mjs
// Baja de trabajadores en ProvinciART para los agentes que en la base pasaron a BAJA.
// La cola art_baja_queue la llena el trigger trg_art_baja_queue_agentes_au (migración 067).
//
// Flujo en ART (nómina → tacho ELIMINAR): /nomina-trabajadores/baja-trabajador/<trabajadorId>
// es un form con un único campo "F. Egreso Empresa" (#fechaEgreso, dd/mm/aaaa) + GUARDAR.
//
// Uso:
//   node scripts/art_baja_trabajador.mjs --pendientes            (dry-run: muestra qué haría)
//   node scripts/art_baja_trabajador.mjs --pendientes --apply    (da de baja de verdad; lo corre la página Robots)
//   node scripts/art_baja_trabajador.mjs --dni 25981890 [--apply]
// Opcionales: --limit N. Env: ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS.
//
// Reglas (decisión RRHH 09/10/2026):
//  - Solo es baja real si el DNI NO tiene ningún tramo distinto de BAJA (cambio de ocupación,
//    beca→nombramiento, etc. cierran un tramo en BAJA y abren otro). Si sigue vigente → SKIPPED SIGUE_ACTIVO.
//  - Fecha: fecha_egreso del último tramo BAJA; si es de hace más de un mes, HOY (misma regla que el alta).
//    Sin fecha_egreso → HOY. Con fecha futura → se deja PENDING para otra corrida.
//  - Se encola recién a la hora de haber pasado a BAJA (margen para que se cree el tramo nuevo).

import dotenv from 'dotenv';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
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
const LIMIT = Number(val('--limit', '0')) || 0;
const MAX_ATTEMPTS = 3;
const ORIGIN = 'https://www.provinciart.com.ar';
const CAPTURE = path.join(appRoot, 'logs', 'art_capture');

function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
async function clickVC(page, loc, label) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); if (!b) throw new Error(`No ubico ${label}`); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const fmtCuil = (c) => { const d = dig(c); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(c || ''); };
const p2 = (n) => String(n).padStart(2, '0');
const ddmmyyyy = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

let db = null;
async function abrirDb() {
  db = await mysql.createConnection({
    host: opt('DB_HOST', '127.0.0.1'), port: Number(opt('DB_PORT', '3306')), user: opt('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '', database: opt('DB_NAME', 'personalv5'), dateStrings: true,
  });
}

// Agentes a procesar, con lo que hace falta para decidir: tramos vigentes, fecha de egreso, CUIL.
async function leerCandidatos() {
  const porDni = val('--dni') ? Number(dig(val('--dni'))) : null;
  const [rows] = await db.query(`
    SELECT q.id, q.dni, q.status, q.attempts,
           p.cuil, CONCAT_WS(' ', p.apellido, p.nombre) AS nombre,
           (SELECT MAX(a.fecha_egreso) FROM agentes a
             WHERE a.dni = q.dni AND a.estado_empleo = 'BAJA' AND a.deleted_at IS NULL) AS fecha_egreso,
           (SELECT GROUP_CONCAT(CONCAT(a.id, ' ', a.estado_empleo) SEPARATOR ', ') FROM agentes a
             WHERE a.dni = q.dni AND a.estado_empleo <> 'BAJA' AND a.deleted_at IS NULL) AS vigentes
      FROM art_baja_queue q
      LEFT JOIN personal p ON p.dni = q.dni
     WHERE ${porDni ? 'q.dni = ?' : `q.status IN ('PENDING','ERROR') AND q.attempts < ${MAX_ATTEMPTS}
       AND q.created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`}
     ORDER BY q.created_at`, porDni ? [porDni] : []);
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function marcar(id, campos) {
  if (!APPLY) return;
  const sets = Object.keys(campos).map((k) => `${k} = ?`).join(', ');
  await db.query(`UPDATE art_baja_queue SET ${sets} WHERE id = ?`, [...Object.values(campos), id]);
}

// Real si es del último mes (y no futura), si no HOY. null si es futura (todavía no egresó).
function fechaParaArt(fechaEgreso) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = String(fechaEgreso).slice(0, 10).split('-').map(Number);
  const f = new Date(y, m - 1, d);
  if (f > hoy) return null;
  const corte = new Date(hoy); corte.setMonth(corte.getMonth() - 1);
  return ddmmyyyy(f >= corte ? f : hoy);
}

async function login(page) {
  await page.goto(opt('ART_LOGIN_URL', `${ORIGIN}/acceso-exclusivo-usuarios-registrados`), { waitUntil: 'domcontentloaded', timeout: 90000 });
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

// Busca el CUIL en la nómina y devuelve el trabajadorId SOLO si la fila es de ese CUIL
// (mismo criterio que art_editar_establecimiento.mjs: con búsqueda vacía/fallida ART puede
// mostrar a todos o el resultado anterior).
async function buscarTrabajadorId(page, cuil) {
  await page.goto(`${ORIGIN}/nomina-trabajadores`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const buscado = dig(cuil);
  if (buscado.length !== 11) return null;
  await typeInto(page, page.locator('#cuil'), fmtCuil(cuil));
  const buscar = page.locator('input[type=submit][value*="BUSCAR" i], input[value*="BUSCAR" i], button:has-text("BUSCAR")').first();
  await clickVC(page, buscar, 'BUSCAR');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (const fr of page.frames()) {
    const id = await fr.evaluate((buscado) => {
      for (const b of document.querySelectorAll('[onclick*="baja-trabajador/"], [onclick*="modificacion-trabajador/"]')) {
        const m = (b.getAttribute('onclick') || '').match(/(?:baja|modificacion)-trabajador\/(\d+)/);
        const fila = b.closest('tr');
        if (m && fila && (fila.innerText || '').replace(/\D/g, '').includes(buscado)) return m[1];
      }
      return null;
    }, buscado).catch(() => null);
    if (id) return id;
  }
  return null;
}

// Mensajes que ART muestra tras GUARDAR: modal, errores del campo, cartel nativo.
async function leerMensajes(page) {
  const textos = [];
  for (const fr of page.frames()) {
    const t = await fr.evaluate(() => [
      ...[...document.querySelectorAll('#modalMessage, #modalMessageV2, .inputError')]
        .filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()),
    ].filter(Boolean)).catch(() => []);
    textos.push(...t);
  }
  return [...new Set(textos)].join(' | ');
}

async function darDeBaja(page, tid, cuil, fecha, ctx) {
  await page.goto(`${ORIGIN}/nomina-trabajadores/baja-trabajador/${tid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Doble control: el form tiene que ser del CUIL buscado antes de tocar nada.
  const cuilForm = await page.evaluate(() => {
    for (const d of document.querySelectorAll('.encabezado-form')) {
      if (/C\.U\.I\.L/i.test(d.innerText)) return (d.querySelector('.result-form')?.innerText || '').replace(/\D/g, '');
    }
    return '';
  });
  if (cuilForm !== dig(cuil)) throw new Error(`El form de baja es de otro CUIL (${cuilForm || 'vacío'}); no se toca`);
  if (!APPLY) return 'PLAN';
  const campo = page.locator('#fechaEgreso');
  await campo.waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate((v) => {
    const e = document.getElementById('fechaEgreso');
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }, fecha);
  if ((await campo.inputValue()).trim() !== fecha) await campo.fill(fecha);
  if ((await campo.inputValue()).trim() !== fecha) throw new Error(`No pude completar F. Egreso Empresa (${fecha})`);
  ctx.cartel = '';
  await page.locator('#formTrabajador input[type=submit][value="GUARDAR"]').click({ timeout: 10000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const msgs = [ctx.cartel, await leerMensajes(page)].filter(Boolean).join(' | ');
  if (msgs) console.log(`   ART: ${msgs}`);
  return msgs;
}

async function main() {
  await abrirDb();
  const filas = await leerCandidatos();
  if (!filas.length) { console.log('Sin bajas pendientes para ART.'); await db.end(); return; }
  await fsp.mkdir(CAPTURE, { recursive: true });
  const { chromium } = await import('playwright');
  const headless = flag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const bctx = await browser.newContext(headless ? { viewport: { width: 1400, height: 1100 } } : { viewport: null });
  const page = await bctx.newPage();
  const ctx = { cartel: '' };
  page.on('dialog', (d) => { ctx.cartel = d.message(); console.log(`   cartel ART: ${ctx.cartel}`); d.accept().catch(() => {}); });
  const cuenta = {};
  const contar = (k) => { cuenta[k] = (cuenta[k] || 0) + 1; };
  let logueado = false;
  try {
    console.log(`Modo: ${APPLY ? 'APPLY (da de baja en ART)' : 'DRY-RUN (solo lee)'} | ${filas.length} agente(s)`);
    for (const r of filas) {
      const quien = `${r.dni} ${r.nombre || ''}`.trim();
      try {
        if (r.vigentes) {
          await marcar(r.id, { status: 'SKIPPED', resultado: 'SIGUE_ACTIVO', last_error: `Tiene tramo vigente: ${r.vigentes}`, finished_at: new Date(), locked_at: null });
          contar('SIGUE_ACTIVO'); console.log(`${quien}: sigue activo (${r.vigentes}) → no se da de baja`); continue;
        }
        // Sin fecha_egreso en la base → HOY (igual que una fecha de hace más de un mes).
        const fecha = r.fecha_egreso ? fechaParaArt(r.fecha_egreso) : ddmmyyyy(new Date());
        if (!fecha) { contar('FUTURA'); console.log(`${quien}: egreso futuro (${r.fecha_egreso}) → queda para otra corrida`); continue; }
        if (dig(r.cuil).length !== 11) throw new Error(`CUIL inválido en personal (${r.cuil || 'vacío'})`);
        await marcar(r.id, { status: 'PROCESSING', attempts: r.attempts + 1, locked_at: new Date(), last_error: null });
        if (!logueado) { await login(page); logueado = true; }
        const tid = await buscarTrabajadorId(page, r.cuil);
        if (!tid) {
          await marcar(r.id, { status: 'DONE', resultado: 'NO_EN_ART', finished_at: new Date(), locked_at: null });
          contar('NO_EN_ART'); console.log(`${quien}: no está en la nómina de ART → nada que dar de baja`); continue;
        }
        const msgs = await darDeBaja(page, tid, r.cuil, fecha, ctx);
        if (!APPLY) { contar('PLAN'); console.log(`${quien}: PLAN → baja en ART (trabajador ${tid}) con F. Egreso ${fecha}`); continue; }
        // Verificar: después de la baja el CUIL ya no tiene que aparecer en la nómina.
        const sigue = await buscarTrabajadorId(page, r.cuil);
        if (sigue) {
          const shot = path.join(CAPTURE, `baja_error_${r.dni}_${stamp()}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          throw new Error(`ART no tomó la baja (sigue en la nómina)${msgs ? `: ${msgs}` : ''}`);
        }
        await marcar(r.id, { status: 'DONE', resultado: 'BAJA_OK', fecha_baja_art: fecha.split('/').reverse().join('-'), trabajador_id: Number(tid), finished_at: new Date(), locked_at: null, last_error: null });
        // Fuera del padrón guardado (art_nomina), así el cruce de la página queda al día.
        await db.query('DELETE FROM art_nomina WHERE cuil = ?', [dig(r.cuil)]);
        contar('BAJA_OK'); console.log(`${quien}: BAJA OK en ART (F. Egreso ${fecha})`);
      } catch (e) {
        const msg = (e?.message || String(e)).slice(0, 1000);
        await marcar(r.id, { status: 'ERROR', last_error: msg, locked_at: null }).catch(() => {});
        contar('ERROR'); console.log(`${quien}: ERROR ${msg}`);
      }
    }
  } finally {
    await browser.close();
    await db?.end().catch(() => {});
  }
  console.log(`Resumen: ${Object.entries(cuenta).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nada'}`);
  if (cuenta.ERROR) process.exitCode = 1;
}
main().catch((e) => { console.error('FATAL', e?.message || e); process.exitCode = 1; });
