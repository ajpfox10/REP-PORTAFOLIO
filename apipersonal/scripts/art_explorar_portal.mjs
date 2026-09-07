// art_explorar_portal.mjs
// Exploración READ-ONLY del portal nuevo de ProvinciART para re-mapear el flujo de alta.
// Reusa el login que ya funciona. NO da de alta nada: solo navega y vuelca DOM/links/screenshots
// a logs/art_capture/ para poder reescribir navigateToAltaTrabajador + selectores del form.
//
// Uso: node scripts/art_explorar_portal.mjs
// Env (del .env): ART_LOGIN_URL, ART_PROVINCIA_USER, ART_PROVINCIA_PASSWORD, ART_HEADLESS

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
function mustEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}
function optEnv(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

const OUT = path.join(appRoot, 'logs', 'art_capture');

// Login real (igual que el script de alta): tipeo char-by-char + click de mouse real,
// para no disparar el reCAPTCHA invisible del login.
async function clickVisibleCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No pude ubicar ${label}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
}
async function typeInto(page, locator, value) {
  await locator.click({ timeout: 15000 });
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Backspace');
  await locator.type(String(value), { delay: Number(process.env.ART_TYPE_DELAY_MS || 35) });
}

// Vuelca todos los frames (main + iframes): url + links/buttons de cada uno.
async function dumpFrames(page, label) {
  await fs.mkdir(OUT, { recursive: true });
  const safe = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const out = [];
  for (const fr of page.frames()) {
    const info = await fr.evaluate(() => {
      const txt = (el) => (el.innerText || el.textContent || el.value || '').trim().slice(0, 80);
      const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
        tag: el.tagName.toLowerCase(), text: txt(el), id: el.id || null,
        href: el.getAttribute('href') || null, onclick: el.getAttribute('onclick') || null,
      })).filter((x) => x.text || x.href || x.onclick);
      return { links: pick('a'), buttons: pick('button,input[type=button],input[type=submit]'), menuish: pick('[id^=menu_],[id^=linkSubmenu],[role=menuitem]') };
    }).catch((e) => ({ error: String(e) }));
    out.push({ frameUrl: fr.url(), name: fr.name() || null, ...info });
  }
  await fs.writeFile(path.join(OUT, `${safe}_frames.json`), JSON.stringify(out, null, 2));
  console.log(`[frames] ${label}: ${out.length} frames`);
}

async function dumpStep(page, label) {
  await fs.mkdir(OUT, { recursive: true });
  const safe = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const url = page.url();

  // links + botones + inputs visibles con su texto/id/name/href/onclick
  const inv = await page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || el.value || '').trim().slice(0, 80);
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: txt(el),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      href: el.getAttribute('href') || null,
      type: el.getAttribute('type') || null,
      value: el.getAttribute('value') || null,
      placeholder: el.getAttribute('placeholder') || null,
      onclick: el.getAttribute('onclick') || null,
      cls: (el.className && String(el.className).slice(0, 60)) || null,
      visible: vis(el),
    }));
    return {
      links: pick('a'),
      buttons: pick('button, input[type=button], input[type=submit]'),
      inputs: pick('input:not([type=hidden]), select, textarea'),
    };
  }).catch((e) => ({ error: String(e) }));

  const html = await page.content().catch(() => '');
  await fs.writeFile(path.join(OUT, `${safe}.html`), html);
  await fs.writeFile(path.join(OUT, `${safe}.json`), JSON.stringify({ label, url, ...inv }, null, 2));
  await page.screenshot({ path: path.join(OUT, `${safe}.png`), fullPage: true }).catch(() => {});
  console.log(`[dump] ${label} -> ${url}`);
  return { url, inv };
}

async function main() {
  const { chromium } = await import('playwright');
  const headless = envFlag('ART_HEADLESS', true);
  const browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
  const context = await browser.newContext(headless ? { viewport: { width: 1400, height: 1000 } } : { viewport: null });
  const page = await context.newPage();

  try {
    const loginUrl = optEnv('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const loginBtn = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first();
    const needsLogin = await loginBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (needsLogin) {
      const loginInputs = page.locator('input:not([type="hidden"]):not([readonly])');
      await typeInto(page, loginInputs.nth(0), mustEnv('ART_PROVINCIA_USER'));
      await typeInto(page, loginInputs.nth(1), mustEnv('ART_PROVINCIA_PASSWORD'));
      await page.waitForTimeout(500);
      await clickVisibleCenter(page, loginBtn, 'Iniciar sesion');
      await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
    await page.waitForTimeout(3000);

    // 1) Página post-login (main frame + todos los iframes)
    await dumpStep(page, '01_post_login');
    await dumpFrames(page, '01_post_login');

    // 2) Ir directo a la nómina (URL confirmada) y volcar sus botones/inputs.
    await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const nom = await dumpStep(page, '04_nomina');
    // ¿Sigue existiendo un botón de alta individual?
    const botonesNomina = (nom.inv.buttons || []).filter((b) => b.visible).map((b) => b.text || b.value).filter(Boolean);
    console.log('[nomina] botones:', JSON.stringify(botonesNomina));

    // 3) Probar la URL vieja del alta individual directamente.
    await page.goto('https://www.provinciart.com.ar/nomina-trabajadores/alta-trabajador', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const alta = await dumpStep(page, '05_alta_trabajador');
    console.log('[alta] url final:', alta.url, '| inputs:', (alta.inv.inputs || []).length);
    // Detalle de campos del form (id/name/label/placeholder) para re-mapear.
    const campos = await page.evaluate(() => {
      const lbl = (el) => {
        if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return l.innerText.trim(); }
        const p = el.closest('.form-group,.field,.row,div'); return p ? (p.innerText || '').trim().slice(0, 60) : '';
      };
      return Array.from(document.querySelectorAll('input:not([type=hidden]),select,textarea')).map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || null,
        id: el.id || null, name: el.getAttribute('name') || null,
        placeholder: el.getAttribute('placeholder') || null, label: lbl(el),
      }));
    }).catch(() => []);
    await fs.writeFile(path.join(OUT, '05_alta_campos.json'), JSON.stringify(campos, null, 2));
    console.log('[alta] campos volcados:', campos.length);

    console.log('OK. Capturas en:', OUT);
  } catch (err) {
    console.error('ERROR explorando:', err?.message || err);
    await dumpStep(page, '99_error').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
