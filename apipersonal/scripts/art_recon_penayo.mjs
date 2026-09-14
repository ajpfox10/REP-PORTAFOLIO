// Recon READ-ONLY dirigida: busca un CUIL en la nómina, saca trabajadorId, abre modificación,
// lee el iframe de establecimientos (lista + rl + eliminar) y abre el buscador de "agregar".
// Uso: node scripts/art_recon_penayo.mjs [CUIL]   default 20-12580743-8 (PENAYO)
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
const CUIL = process.argv[2] || '20-12580743-8';
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

  // 1) Nómina -> buscar por CUIL
  await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await typeInto(page, page.locator('#cuil'), CUIL);
  const buscar = page.locator('input[type=submit][value*="BUSCAR" i], input[value*="BUSCAR" i], button:has-text("BUSCAR")').first();
  await clickVC(page, buscar);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const grid = await page.evaluate((cuil) => {
    const html = document.body.innerHTML;
    const ids = [...html.matchAll(/modificacion-trabajador\/(\d+)/g)].map(m => m[1]);
    const cuilRe = /\b\d{2}-\d{8}-\d\b/g;
    const rows = Array.from(document.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim())).filter(r => r.some(x=>cuilRe.test(x)));
    return { trabajadorIds: [...new Set(ids)], rows };
  }, CUIL);
  console.log('CUIL buscado:', CUIL);
  console.log('trabajadorIds en resultado:', JSON.stringify(grid.trabajadorIds));
  console.log('filas:', JSON.stringify(grid.rows));
  const tid = grid.trabajadorIds[0];
  if (!tid) { console.log('NO se encontró trabajador para ese CUIL en la búsqueda.'); await browser.close(); process.exit(0); }

  // 2) Modificación -> iframe establecimientos
  await page.goto(`https://www.provinciart.com.ar/nomina-trabajadores/modificacion-trabajador/${tid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const rlArg = await page.evaluate(() => {
    const b = document.getElementById('altaEstablecimientos');
    const m = b && (b.getAttribute('onclick')||'').match(/buscarEstablecimiento\('?(\d+)'?\)/);
    const hidden = document.getElementById('establecimientos');
    return { rl: m ? m[1] : null, establecimientosHidden: hidden ? hidden.value : null };
  });
  const fr = page.frames().find(f => /establecimientos\.php/i.test(f.url()));
  let estabInfo = null;
  if (fr) estabInfo = await fr.evaluate(() => ({
    url: location.href,
    rows: Array.from(document.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>(td.innerText||'').replace(/\s+/g,' ').trim())).filter(r=>r.length),
    eliminar: Array.from(document.querySelectorAll('.btnQuitar')).map(b=>b.getAttribute('onclick')||''),
  }));
  console.log('\ntrabajadorId:', tid, '| rl:', rlArg.rl, '| establecimientos(hidden):', rlArg.establecimientosHidden);
  console.log('iframe establecimientos:', JSON.stringify(estabInfo, null, 2));

  // 3) Abrir el buscador de "agregar" y ver sus controles + endpoint
  await page.locator('#altaEstablecimientos').click({ timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  const addFrames = page.frames().filter(f => /establecimiento|buscar/i.test(f.url())).map(f=>f.url());
  console.log('\nframes tras click Agregar:', JSON.stringify(addFrames, null, 2));
  for (const f of page.frames()) {
    if (/buscar.*establec|establec.*buscar|seleccionar_establec/i.test(f.url())) {
      const ctl = await f.evaluate(() => ({ url: location.href, inputs: Array.from(document.querySelectorAll('input,select,button,a[onclick]')).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||null,name:el.getAttribute('name')||null,onclick:el.getAttribute('onclick')||null,val:(el.value||'').slice(0,40)})) })).catch(()=>null);
      console.log('add-iframe:', JSON.stringify(ctl, null, 2));
    }
  }
  await page.screenshot({ path: path.join(OUT, `recon_penayo_${CUIL.replace(/\D/g,'')}.png`), fullPage: true }).catch(()=>{});
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
