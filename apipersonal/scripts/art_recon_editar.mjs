// Recon READ-ONLY de la página de modificación de un trabajador en ART.
// Uso: node scripts/art_recon_editar.mjs <trabajadorId>   (default 5159769 = RICARDO RODRIGUEZ)
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n}`); return v; };
const OUT = path.join(appRoot, 'logs', 'art_capture');
const ID = process.argv[2] || '5159769';
async function clickVC(p, l) { await l.waitFor({ state: 'visible', timeout: 20000 }); const b = await l.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(300); await p.mouse.down(); await p.waitForTimeout(100); await p.mouse.up(); }
async function typeInto(p, l, v) { await l.click({ timeout: 15000 }); await l.press('Control+A'); await l.press('Backspace'); await l.type(String(v), { delay: 35 }); }

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
  await page.waitForTimeout(1200);
  await page.goto(`https://www.provinciart.com.ar/nomina-trabajadores/modificacion-trabajador/${ID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const campos = await page.evaluate(() => {
    const lbl = (el) => { if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return (l.innerText||'').trim(); } const p = el.closest('.form-group,.field,.row,td,div'); return p ? (p.innerText||'').trim().slice(0,50) : ''; };
    const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).map(el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.id||null, name: el.getAttribute('name')||null, value: (el.value!=null?String(el.value).slice(0,40):null), label: lbl(el) }));
    const botones = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button]')).map(b => (b.innerText||b.value||'').trim()).filter(Boolean);
    return { url: location.href, title: document.title, inputs, botones, bodyText: (document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,600) };
  });
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, `editar_${ID}.html`), await page.content());
  await page.screenshot({ path: path.join(OUT, `editar_${ID}.png`), fullPage: true }).catch(()=>{});
  console.log(JSON.stringify(campos, null, 2));
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
