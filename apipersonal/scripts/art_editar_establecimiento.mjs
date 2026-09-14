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
// Opcionales: --estab 488242 (destino), --limit N.
// Env: ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS,
//      ART_COMPARACION_DIR (salida; default D:\G\comparacion).

import dotenv from 'dotenv';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

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
  const esCuil = String(cuilOrDni).replace(/\D/g, '').length === 11;
  await typeInto(page, page.locator('#cuil'), esCuil ? cuilOrDni : '');
  if (!esCuil) await typeInto(page, page.locator('#nombre'), ''); // por si acaso
  const buscar = page.locator('input[type=submit][value*="BUSCAR" i], input[value*="BUSCAR" i], button:has-text("BUSCAR")').first();
  await clickVC(page, buscar, 'BUSCAR');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => { const ids = [...document.body.innerHTML.matchAll(/modificacion-trabajador\/(\d+)/g)].map(m => m[1]); return [...new Set(ids)][0] || null; });
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
  const cuils = leerEntradas();
  if (!cuils.length) { console.log('Sin entradas. Usá --cuil <cuil> o --excel <archivo>.'); return; }
  await fsp.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await fsp.mkdir(CAPTURE, { recursive: true });
  const { chromium } = await import('playwright');
  const headless = flag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const ctx = await browser.newContext(headless ? { viewport: { width: 1400, height: 1100 } } : { viewport: null });
  const page = await ctx.newPage();
  const resultados = [];
  try {
    await login(page);
    console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo lee)'} | destino establecimiento ${ESTAB_DESTINO} | ${cuils.length} agente(s)`);
    for (const cuil of cuils) {
      const row = { cuil, trabajadorId: null, establecimiento_actual: '', accion: '', estado: '' };
      try {
        const tid = await buscarTrabajadorId(page, cuil);
        if (!tid) { row.estado = 'NO_EN_ART'; row.accion = 'alta nueva (no editar)'; resultados.push(row); console.log(`${cuil}: NO está en ART`); continue; }
        row.trabajadorId = tid;
        const { rl, establecimientos } = await leerEstablecimientos(page, tid);
        row.establecimiento_actual = establecimientos.map(e => `${e.id} ${e.label}`).join(' | ');
        const yaTiene = establecimientos.some(e => e.id === ESTAB_DESTINO);
        const otros = establecimientos.filter(e => e.id !== ESTAB_DESTINO);
        if (yaTiene && otros.length === 0) { row.estado = 'YA_OK'; row.accion = 'ninguna'; resultados.push(row); console.log(`${cuil}: ya está SOLO en destino`); continue; }
        row.accion = `${yaTiene ? '' : `agregar ${ESTAB_DESTINO}; `}${otros.length ? `quitar ${otros.map(o => o.id).join(',')}` : ''}`.trim();
        if (!APPLY) { row.estado = 'PLAN (dry-run)'; resultados.push(row); console.log(`${cuil}: PLAN -> ${row.accion}`); continue; }
        // ── APPLY ──────────────────────────────────────────────────────────
        // 1) Agregar destino PRIMERO (para no dejar al trabajador sin establecimiento).
        if (!yaTiene) {
          await page.locator('#altaEstablecimientos').click({ timeout: 8000 });
          await page.waitForTimeout(2000);
          const addFr = page.frames().find(f => /agregar_establecimiento\.php/i.test(f.url()));
          if (!addFr) throw new Error('No se abrió el buscador de agregar');
          await addFr.locator('#nombre').fill(ESTAB_LABEL_HINT);
          await addFr.locator('input[type=submit], button[type=submit]').first().click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2500);
          // Elegir la fila que matchee el destino y confirmar (botón/enlace de la fila)
          const addFr2 = page.frames().find(f => /agregar_establecimiento\.php/i.test(f.url())) || addFr;
          const pick = addFr2.locator(`text=/${ESTAB_LABEL_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/i`).first();
          await pick.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2500);
        }
        // 2) Guardar
        await page.locator('#btnGuardar, input[value="GUARDAR" i]').first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(3000);
        // 3) Releer para verificar que el destino quedó
        const rl2 = (await leerEstablecimientos(page, tid));
        const okDestino = rl2.establecimientos.some(e => e.id === ESTAB_DESTINO);
        if (!okDestino) throw new Error('No se pudo agregar el destino; NO se elimina nada');
        // 4) Recién ahora eliminar los viejos
        for (const o of rl2.establecimientos.filter(e => e.id !== ESTAB_DESTINO)) {
          await page.request.get(`https://www.provinciart.com.ar/modules/usuarios_registrados/clientes/nomina_de_trabajadores/eliminar_establecimiento.php?rl=${rl2.rl}&id=${o.id}`, { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(1200);
        }
        await page.locator('#btnGuardar, input[value="GUARDAR" i]').first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const fin = (await leerEstablecimientos(page, tid)).establecimientos;
        row.estado = fin.length === 1 && fin[0].id === ESTAB_DESTINO ? 'OK' : `PARCIAL (${fin.map(e => e.id).join(',')})`;
        await page.screenshot({ path: path.join(CAPTURE, `editar_${String(cuil).replace(/\D/g, '')}_${stamp()}.png`), fullPage: true }).catch(() => {});
        console.log(`${cuil}: ${row.estado}`);
      } catch (e) {
        row.estado = 'ERROR'; row.accion = row.accion || (e?.message || String(e)).slice(0, 120);
        console.log(`${cuil}: ERROR ${e?.message || e}`);
      }
      resultados.push(row);
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
  }
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exitCode = 1; });
