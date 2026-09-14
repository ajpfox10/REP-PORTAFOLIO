// art_explorar_carga_masiva.mjs
// Exploración READ-ONLY de https://www.provinciart.com.ar/carga-masiva-trabajadores
// para encontrar el control de "bajar nómina completa". Reusa el login que ya funciona.
// NO envía nada: navega, vuelca DOM/links/botones/inputs y lista candidatos de descarga.
//
// Uso: node scripts/art_explorar_carga_masiva.mjs
// Env: ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'on'].includes(String(raw).trim().toLowerCase());
}
function mustEnv(name) { const v = process.env[name]?.trim(); if (!v) throw new Error(`Falta ${name} en .env`); return v; }
function optEnv(name, fallback = '') { return process.env[name]?.trim() || fallback; }

const OUT = path.join(appRoot, 'logs', 'art_capture');

async function clickVisibleCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No pude ubicar ${label}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
}
async function typeInto(page, locator, value) {
  await locator.click({ timeout: 15000 });
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Backspace');
  await locator.type(String(value), { delay: Number(process.env.ART_TYPE_DELAY_MS || 35) });
}

async function dumpStep(page, label) {
  await fs.mkdir(OUT, { recursive: true });
  const safe = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const url = page.url();
  const inv = await page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || el.value || '').trim().slice(0, 100);
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
      tag: el.tagName.toLowerCase(), text: txt(el), id: el.id || null, name: el.getAttribute('name') || null,
      href: el.getAttribute('href') || null, type: el.getAttribute('type') || null, value: el.getAttribute('value') || null,
      onclick: el.getAttribute('onclick') || null, download: el.getAttribute('download'), cls: (el.className && String(el.className).slice(0, 70)) || null,
      visible: vis(el),
    }));
    return { links: pick('a'), buttons: pick('button, input[type=button], input[type=submit]'), inputs: pick('input:not([type=hidden]), select, textarea'), bodyText: (document.body.innerText || '').replace(/\s+/g,' ').trim().slice(0, 4000) };
  }).catch((e) => ({ error: String(e) }));
  await fs.writeFile(path.join(OUT, `${safe}.html`), await page.content().catch(() => ''));
  await fs.writeFile(path.join(OUT, `${safe}.json`), JSON.stringify({ label, url, ...inv }, null, 2));
  await page.screenshot({ path: path.join(OUT, `${safe}.png`), fullPage: true }).catch(() => {});
  console.log(`[dump] ${label} -> ${url}`);
  return { url, inv };
}

function candidatos(inv) {
  const re = /descarg|nomina|nómina|export|baja|excel|csv|xls|plantilla|template|listado/i;
  const all = [...(inv.links||[]), ...(inv.buttons||[])].filter(x => x.visible !== false);
  return all.filter(x => re.test([x.text, x.value, x.href, x.id, x.onclick, x.download, x.cls].join(' ')))
            .map(x => ({ tag: x.tag, text: x.text || x.value, id: x.id, href: x.href, download: x.download, onclick: x.onclick, cls: x.cls }));
}

async function main() {
  const { chromium } = await import('playwright');
  const headless = envFlag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const context = await browser.newContext(headless ? { viewport: { width: 1400, height: 1000 } } : { viewport: null, acceptDownloads: true });
  const page = await context.newPage();
  try {
    const loginUrl = optEnv('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const loginBtn = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first();
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const li = page.locator('input:not([type="hidden"]):not([readonly])');
      await typeInto(page, li.nth(0), mustEnv('ART_PROVINCIA_USER'));
      await typeInto(page, li.nth(1), mustEnv('ART_PROVINCIA_PASSWORD'));
      await page.waitForTimeout(500);
      await clickVisibleCenter(page, loginBtn, 'Iniciar sesion');
      await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
    await page.waitForTimeout(2500);

    await page.goto('https://www.provinciart.com.ar/carga-masiva-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const cm = await dumpStep(page, 'cm_carga_masiva');
    console.log('URL final:', cm.url);
    console.log('CANDIDATOS de descarga:', JSON.stringify(candidatos(cm.inv), null, 2));
    console.log('Botones visibles:', JSON.stringify((cm.inv.buttons||[]).filter(b=>b.visible).map(b=>b.text||b.value).filter(Boolean)));
    console.log('OK. Capturas en:', OUT);
  } catch (err) {
    console.error('ERROR:', err?.message || err);
    await dumpStep(page, 'cm_error').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main();
