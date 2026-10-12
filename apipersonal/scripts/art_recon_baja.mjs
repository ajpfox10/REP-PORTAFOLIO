// art_recon_baja.mjs — READ-ONLY: busca un CUIL en la nómina y vuelca el HTML del botón ELIMINAR
// (no lo clickea). Uso: node scripts/art_recon_baja.mjs --cuil 20-12345678-9 [--abrir]
// --abrir: si ELIMINAR es un link GET a un form, lo abre y vuelca el form SIN enviarlo.
import dotenv from 'dotenv'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url)); const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const args = process.argv.slice(2); const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const CUIL = val('--cuil') || '20-12345678-9'; const ABRIR = args.includes('--abrir');
const OUT = path.join(appRoot, 'logs', 'art_capture'); fs.mkdirSync(OUT, { recursive: true });
async function clickVC(page, loc) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true }); const page = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
page.on('dialog', d => { console.log('DIALOG (dismiss):', d.type(), d.message()); d.dismiss().catch(() => {}); });
try {
  await page.goto(process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const lb = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")').first();
  if (await lb.isVisible({ timeout: 5000 }).catch(() => false)) {
    const li = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(li.nth(0), process.env.ART_PROVINCIA_USER.trim()); await typeInto(li.nth(1), process.env.ART_PROVINCIA_PASSWORD.trim());
    await clickVC(page, lb); await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => {});
  }
  await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await typeInto(page.locator('#cuil'), CUIL);
  await clickVC(page, page.locator('input[value*="BUSCAR" i], button:has-text("BUSCAR")').first());
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const out = { frames: [], filas: [] };
    for (const tr of document.querySelectorAll('tr')) { if (/\d{2}-\d{8}-\d/.test(tr.innerText)) out.filas.push(tr.outerHTML); }
    for (const f of document.querySelectorAll('iframe')) out.frames.push(f.src);
    const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).filter(t => /elimin|baja/i.test(t));
    out.scripts = scripts.map(s => s.slice(0, 4000));
    out.modales = [...document.querySelectorAll('[id*="dialog" i], [id*="modal" i], [class*="modal" i]')].map(e => e.outerHTML.slice(0, 3000));
    return out;
  });
  for (const fr of page.frames()) if (fr !== page.mainFrame()) {
    const fx = await fr.evaluate(() => [...document.querySelectorAll('tr')].filter(t => /\d{2}-\d{8}-\d/.test(t.innerText)).map(t => t.outerHTML)).catch(() => []);
    if (fx.length) info.filas.push(...fx.map(x => `[frame ${fr.url()}] ` + x));
  }
  fs.writeFileSync(path.join(OUT, 'recon_baja.json'), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(OUT, 'recon_baja_grilla.png'), fullPage: true });
  console.log(JSON.stringify(info, null, 2).slice(0, 12000));
  if (ABRIR) {
    const href = await page.evaluate(() => { for (const fr of [document, ...[...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument; } catch { return null; } })]) { const b = fr?.querySelector('.btnQuitar[onclick*="baja-trabajador/"]'); const m = b && b.getAttribute('onclick').match(/baja-trabajador\/(\d+)/); if (m) return location.origin + '/nomina-trabajadores/baja-trabajador/' + m[1]; } return null; });
    console.log('href eliminar:', href);
    if (href && /^https?:/.test(href)) {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(3000);
      const form = await page.evaluate(() => [...document.querySelectorAll('form')].map(f => f.outerHTML).join('\n\n') || document.body.innerHTML.slice(0, 20000));
      fs.writeFileSync(path.join(OUT, 'recon_baja_form.html'), form); await page.screenshot({ path: path.join(OUT, 'recon_baja_form.png'), fullPage: true });
      console.log(form.slice(0, 15000));
    }
  }
} finally { await browser.close(); }
