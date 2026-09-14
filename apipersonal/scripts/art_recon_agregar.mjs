// Recon READ-ONLY del flujo "agregar establecimiento": abre el buscador y captura network
// + controles del modal, SIN confirmar ningún agregado. Uso: node scripts/art_recon_agregar.mjs [trabajadorId]
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
const TID = process.argv[2] || '4714602'; // PENAYO
async function clickVC(p, l) { await l.waitFor({ state: 'visible', timeout: 20000 }); const b = await l.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(300); await p.mouse.down(); await p.waitForTimeout(100); await p.mouse.up(); }
async function typeInto(p, l, v) { await l.click({ timeout: 15000 }); await l.press('Control+A'); await l.press('Backspace'); await l.type(String(v), { delay: 35 }); }

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();
const net = [];
page.on('request', r => { const u=r.url(); if(/establecimiento|nomina_de_trabajadores/i.test(u)) net.push(`${r.method()} ${u}`); });
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
  await page.goto(`https://www.provinciart.com.ar/nomina-trabajadores/modificacion-trabajador/${TID}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  net.length = 0; // limpiar; capturar sólo lo del click Agregar
  await page.locator('#altaEstablecimientos').click({ timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(3000);
  // Dump de TODOS los frames tras abrir el buscador
  const frameDump = [];
  for (const f of page.frames()) {
    if (/about:blank/.test(f.url())) continue;
    const info = await f.evaluate(() => ({ url: location.href, inputs: Array.from(document.querySelectorAll('input,select,button,a[onclick],li,option')).slice(0,40).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||null,name:el.getAttribute('name')||null,onclick:(el.getAttribute('onclick')||'').slice(0,120),val:(el.value||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,50)})).filter(x=>x.id||x.name||x.onclick||x.val) })).catch(()=>null);
    if (info) frameDump.push(info);
  }
  await fs.mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `recon_agregar_${TID}.png`), fullPage: true }).catch(()=>{});
  console.log('=== NETWORK tras click Agregar ==='); console.log(net.join('\n'));
  console.log('\n=== FRAMES/controles ==='); console.log(JSON.stringify(frameDump, null, 2).slice(0, 6000));
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
