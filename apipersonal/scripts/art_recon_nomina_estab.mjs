// Recon READ-ONLY: busca la nómina de un establecimiento en /nomina-trabajadores
// y vuelca la estructura de la tabla de resultados (headers, nº filas, paginación).
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n}`); return v; };
const ESTAB = process.argv[2] || '488242'; // default: G.CATAN KM.32
async function clickVC(page, loc) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(opt('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados'), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const lb = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")').first();
  if (await lb.isVisible({ timeout: 5000 }).catch(() => false)) {
    const li = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(page, li.nth(0), must('ART_PROVINCIA_USER'));
    await typeInto(page, li.nth(1), must('ART_PROVINCIA_PASSWORD'));
    await page.waitForTimeout(400); await clickVC(page, lb);
    await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.selectOption('#establecimiento', ESTAB).catch(async () => { await page.locator('#establecimiento').selectOption({ value: ESTAB }); });
  const buscar = page.locator('input[type=submit][value*="BUSCAR" i], input[value*="BUSCAR" i], button:has-text("BUSCAR")').first();
  await clickVC(page, buscar);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const scored = tables.map((t) => ({ t, rows: t.querySelectorAll('tr').length })).sort((a, b) => b.rows - a.rows);
    const main = scored[0]?.t;
    const headers = main ? Array.from(main.querySelectorAll('thead th, tr:first-child th, tr:first-child td')).map((h) => (h.innerText || '').trim()) : [];
    const bodyRows = main ? Array.from(main.querySelectorAll('tbody tr')).length || (main.querySelectorAll('tr').length - 1) : 0;
    const firstRows = main ? Array.from(main.querySelectorAll('tbody tr')).slice(0, 3).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim())) : [];
    const pag = Array.from(document.querySelectorAll('.pagination, [class*=paginac], .dataTables_paginate, [id*=paginac]')).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 3);
    const totalTxt = (document.body.innerText.match(/(\d+)\s+(resultado|registro|trabajador)/i) || [])[0] || null;
    return { url: location.href, tablesCount: tables.length, headers, bodyRows, firstRows, pag, totalTxt };
  });
  await fs.mkdir(path.join(appRoot, 'logs', 'art_capture'), { recursive: true });
  await page.screenshot({ path: path.join(appRoot, 'logs', 'art_capture', `recon_estab_${ESTAB}.png`), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(appRoot, 'logs', 'art_capture', `recon_estab_${ESTAB}.html`), await page.content());
  console.log(JSON.stringify(info, null, 2));
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
