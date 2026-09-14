// Probe READ-ONLY: baja el cuerpo de bajar_nomina_completa.php autenticado y lo inspecciona.
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n}`); return v; };
async function clickVisibleCenter(page, loc) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(opt('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados'), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const btn = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")').first();
  if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
    const li = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(page, li.nth(0), must('ART_PROVINCIA_USER'));
    await typeInto(page, li.nth(1), must('ART_PROVINCIA_PASSWORD'));
    await page.waitForTimeout(400);
    await clickVisibleCenter(page, btn);
    await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  const url = 'https://www.provinciart.com.ar/modules/usuarios_registrados/clientes/carga_masiva_trabajadores/bajar_nomina_completa.php?idempresa=66478';
  const resp = await page.request.get(url, { timeout: 60000 });
  const headers = resp.headers();
  const buf = await resp.body();
  const raw = path.join(appRoot, 'logs', 'art_capture', 'bajar_nomina_completa_raw.bin');
  await fs.mkdir(path.dirname(raw), { recursive: true });
  await fs.writeFile(raw, buf);
  const text = buf.toString('latin1');
  console.log(JSON.stringify({ status: resp.status(), headers, bytes: buf.length, raw }, null, 2));
  console.log('---- primeros 1500 chars ----');
  console.log(text.slice(0, 1500));
  console.log('---- últimos 400 chars ----');
  console.log(text.slice(-400));
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
