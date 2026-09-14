// Probe READ-ONLY: busca CUILs en la nómina de ART SIN filtrar establecimiento
// (cruza todos los hospitales) para validar el discriminador "cargado / no cargado".
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n}`); return v; };
const GRID = 'https://www.provinciart.com.ar/modules/usuarios_registrados/clientes/nomina_de_trabajadores/index_busqueda.php';
async function clickVC(p, l) { await l.waitFor({ state: 'visible', timeout: 20000 }); const b = await l.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(300); await p.mouse.down(); await p.waitForTimeout(100); await p.mouse.up(); }
async function typeInto(p, l, v) { await l.click({ timeout: 15000 }); await l.press('Control+A'); await l.press('Backspace'); await l.type(String(v), { delay: 35 }); }

const CUILS = process.argv.slice(2).length ? process.argv.slice(2) : ['20-12580743-8', '20-31917664-1']; // PENAYO (esperado: sí) / BORDA (esperado: no)
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
  for (const cuil of CUILS) {
    const url = `${GRID}?cuil=${encodeURIComponent(cuil)}&nombre=&establecimiento=&frm=formNominaTrabajadores&pagina=1&ob=3&`;
    const r = await page.request.get(url, { timeout: 60000 });
    const html = await r.text();
    const info = await page.evaluate((h) => {
      const doc = new DOMParser().parseFromString(h, 'text/html');
      const cuilRe = /\b\d{2}-\d{8}-\d\b/;
      const rows = Array.from(doc.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim())).filter(r => r.some(x => cuilRe.test(x)));
      const total = (doc.body.innerText.match(/(\d+)\s+registro/i) || [])[1];
      return { hits: rows.length, sample: rows.slice(0,2), total: total ? Number(total) : null };
    }, html);
    console.log(`CUIL ${cuil} -> hits:${info.hits} total:${info.total} ${JSON.stringify(info.sample)}`);
  }
} catch (e) { console.error('ERR', e?.message || e); process.exitCode = 1; }
finally { await browser.close(); }
