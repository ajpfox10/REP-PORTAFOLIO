// Recon READ-ONLY del iframe de establecimientos dentro de modificacion-trabajador.
// Uso: node scripts/art_recon_iframe_estab.mjs <trabajadorId>   (default 5159769)
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
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
  await page.waitForTimeout(1000);
  await page.goto(`https://www.provinciart.com.ar/nomina-trabajadores/modificacion-trabajador/${ID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Abrir el modal de establecimientos (por si el iframe se puebla al click)
  const btn = page.locator('#altaEstablecimientos');
  if (await btn.count()) { await btn.click({ timeout: 8000 }).catch(()=>{}); await page.waitForTimeout(2000); }
  // Buscar el frame del iframe de establecimientos
  const fr = page.frames().find(f => /establecimientos\.php/i.test(f.url()));
  const dump = { frameUrl: fr ? fr.url() : null, frames: page.frames().map(f=>f.url()) };
  if (fr) {
    dump.iframe = await fr.evaluate(() => {
      const txt = (el) => (el.innerText || el.textContent || el.value || '').replace(/\s+/g,' ').trim().slice(0,80);
      const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.id||null, name: el.getAttribute('name')||null, text: txt(el), value: (el.value!=null?String(el.value).slice(0,50):null), onclick: el.getAttribute('onclick')||null, cls: (el.className&&String(el.className).slice(0,50))||null }));
      return { url: location.href, inputs: pick('input,select,textarea'), botones: pick('button,input[type=button],input[type=submit],a[onclick]'), rows: Array.from(document.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>(td.innerText||'').replace(/\s+/g,' ').trim())).filter(r=>r.length), bodyText: (document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,500) };
    });
    await fs.writeFile(path.join(OUT, `iframe_estab_${ID}.html`), await fr.content());
  }
  await page.screenshot({ path: path.join(OUT, `iframe_estab_${ID}.png`), fullPage: true }).catch(()=>{});
  console.log(JSON.stringify(dump, null, 2));
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
