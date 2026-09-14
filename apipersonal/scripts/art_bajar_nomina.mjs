// art_bajar_nomina.mjs
// Baja la nómina de trabajadores de ProvinciART a un Excel.
//
// El botón oficial "BAJAR NÓMINA COMPLETA" (bajar_nomina_completa.php?idempresa=...) está ROTO
// del lado de ProvinciART: su PHP se queda sin memoria (Fatal error en oracle_funcs.php) al armar
// la lista entera. Workaround: consultamos la grilla paginada de /nomina-trabajadores por
// establecimiento (consultas chicas que sí andan) y juntamos todas las páginas.
//
// Uso:
//   node scripts/art_bajar_nomina.mjs                 -> G. Catán KM.32 (488242)
//   node scripts/art_bajar_nomina.mjs 488242 289012   -> establecimientos indicados
//   node scripts/art_bajar_nomina.mjs --all           -> TODOS los establecimientos del select
// Env: ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS, ART_NOMINA_DIR

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n} en .env`); return v; };
function envFlag(n, f = false) { const r = process.env[n]; if (r == null || r === '') return f; return ['1', 'true', 'yes', 'si', 'on'].includes(String(r).trim().toLowerCase()); }

const OUT_DIR = opt('ART_NOMINA_DIR', path.join(appRoot, 'logs', 'art'));
const GRID = 'https://www.provinciart.com.ar/modules/usuarios_registrados/clientes/nomina_de_trabajadores/index_busqueda.php';
const DEFAULT_ESTAB = '488242'; // 109 - HOSPITAL G.CATAN KM.32

function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
async function clickVC(page, loc, label) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); if (!b) throw new Error(`No ubico ${label}`); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }

// Parsea un fragmento de grilla: devuelve filas {trabajador,email,cuil} y el nº de página máximo.
async function parseGrid(page, html) {
  return page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, 'text/html');
    const cuilRe = /\b\d{2}-\d{8}-\d\b/;
    const rows = [];
    for (const tr of Array.from(doc.querySelectorAll('tr'))) {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim());
      if (!tds.length) continue;
      const cuil = (tds.find((t) => cuilRe.test(t)) || '').match(cuilRe)?.[0] || '';
      if (!cuil) continue; // saltea header y filas sin CUIL
      rows.push({ trabajador: tds[0] || '', email: tds[1] && !cuilRe.test(tds[1]) ? tds[1] : '', cuil });
    }
    let maxPage = 1;
    for (const m of h.matchAll(/pagina=(\d+)/g)) maxPage = Math.max(maxPage, Number(m[1]));
    const total = (doc.body.innerText.match(/(\d+)\s+registro/i) || [])[1];
    return { rows, maxPage, total: total ? Number(total) : null };
  }, html);
}

async function bajarEstablecimiento(page, estabId, label) {
  const url1 = `${GRID}?cuil=&nombre=&establecimiento=${estabId}&frm=formNominaTrabajadores&pagina=1&ob=3&`;
  const r1 = await page.request.get(url1, { timeout: 60000 });
  const html1 = await r1.text();
  const p1 = await parseGrid(page, html1);
  const maxPage = p1.maxPage;
  const map = new Map();
  for (const r of p1.rows) map.set(r.cuil, r);
  for (let n = 2; n <= maxPage; n++) {
    const u = `${GRID}?cuil=&nombre=&establecimiento=${estabId}&frm=formNominaTrabajadores&pagina=${n}&ob=3&`;
    const rr = await page.request.get(u, { timeout: 60000 });
    const pr = await parseGrid(page, await rr.text());
    for (const r of pr.rows) map.set(r.cuil, r);
    if (n % 10 === 0 || n === maxPage) console.log(`  [${label}] página ${n}/${maxPage} — acumulados ${map.size}`);
  }
  return { total: p1.total, rows: [...map.values()].map((r) => ({ establecimiento: label, ...r })) };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const estabArgs = args.filter((a) => /^\d+$/.test(a));
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { chromium } = await import('playwright');
  const headless = envFlag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const ctx = await browser.newContext(headless ? { viewport: { width: 1400, height: 1000 } } : { viewport: null });
  const page = await ctx.newPage();
  try {
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
    await page.waitForTimeout(1500);
    await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // mapa id -> label del select
    const options = await page.evaluate(() => Array.from(document.querySelectorAll('#establecimiento option'))
      .map((o) => ({ id: o.value, label: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
      .filter((o) => o.id && o.id !== '-1'));
    const labelOf = (id) => options.find((o) => o.id === id)?.label || id;

    let targets;
    if (all) targets = options.map((o) => o.id);
    else if (estabArgs.length) targets = estabArgs;
    else targets = [DEFAULT_ESTAB];

    console.log(`Establecimientos a bajar: ${targets.length}`);
    const todo = [];
    for (const id of targets) {
      const label = labelOf(id);
      console.log(`→ ${label} (${id})`);
      const { total, rows } = await bajarEstablecimiento(page, id, label);
      console.log(`  OK: ${rows.length} trabajadores${total != null ? ` (total informado: ${total})` : ''}`);
      todo.push(...rows);
    }

    const ws = XLSX.utils.json_to_sheet(todo.map((r) => ({
      Establecimiento: r.establecimiento, Trabajador: r.trabajador, CUIL: r.cuil, Email: r.email,
    })));
    ws['!cols'] = [{ wch: 55 }, { wch: 35 }, { wch: 16 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nomina ART');
    const suf = all ? 'TODOS' : targets.join('-');
    const dest = path.join(OUT_DIR, `nomina_ART_${suf}_${stamp()}.xlsx`);
    XLSX.writeFile(wb, dest);
    console.log(JSON.stringify({ ok: true, archivo: dest, trabajadores: todo.length }));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main();
