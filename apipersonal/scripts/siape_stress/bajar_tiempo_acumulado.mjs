// bajar_tiempo_acumulado.mjs
// Baja el reporte "Tiempo Acumulado" de Oracle Discoverer (SIAPE) a Excel y lo
// copia a D:\G\comparacion\TIEMPO ACUMULADO.xls (pisando el existente).
// Año = SIEMPRE el en curso (dinámico). Credenciales: SIAPE_USER/SIAPE_PASS del .env.
//
// Requiere: npm i playwright   +   npx playwright install chrome
// Uso: node bajar_tiempo_acumulado.mjs            (headful, para ver/depurar)
//      node bajar_tiempo_acumulado.mjs --headless (para agendado)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const env = readEnv(path.join(ROOT, '.env'));
const USER = env.SIAPE_USER;
const PASS = env.SIAPE_PASS;
const ANIO = String(new Date().getFullYear() - 1);       // año ANTERIOR al en curso (dinámico)
const DEST = 'D:\\G\\comparacion\\TIEMPO ACUMULADO.xls';  // destino que lee el pipeline
const URL  = 'http://app.siape.gba.gov.ar/discoverer/app/econnection?event=connectWithKey&connectionKey=cf_a633&clientType=viewer';
const HEADLESS = process.argv.includes('--headless');
const LOG = (m) => { const s = `${new Date().toISOString()}  ${m}`; console.log(s); fs.appendFileSync(path.join(DIR, 'bajar.log'), s + '\n'); };

async function registrar(estado, motivo, filas) {
  try {
    const cn = await mysql.createConnection({
      host: env.DB_HOST || '127.0.0.1', port: +(env.DB_PORT || 3306),
      user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'personalv5',
    });
    await cn.query(
      `INSERT INTO descarga_tiempo_acumulado (estado, motivo, filas, archivo) VALUES (?,?,?,?)`,
      [estado, motivo ? String(motivo).slice(0, 250) : null, filas ?? null, DEST]);
    await cn.end();
  } catch (e) { LOG('registrar() falló: ' + e.message); }
}

function contarFilas(fp) {
  try {
    const wb = XLSX.readFile(fp, { raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    let n = 0;
    for (let i = 5; i < rows.length; i++) { const r = rows[i]; if (r && r[2] != null && String(r[2]).replace(/\D/g, '')) n++; }
    return n;
  } catch { return null; }
}

function readEnv(fp) {
  const o = {};
  if (!fs.existsSync(fp)) return o;
  for (const raw of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    o[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return o;
}

async function main() {
  if (!USER || !PASS) throw new Error('Falta SIAPE_USER / SIAPE_PASS en .env');
  LOG(`START headless=${HEADLESS} anio=${ANIO}`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: HEADLESS,
    args: ['--ignore-certificate-errors', '--ssl-version-min=tls1'],
  });
  const ctx = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  try {
    // 1) Ir a la URL -> redirige a login SSO
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    // 2) Login SSO (usuario suele venir precargado; completamos igual)
    await page.waitForSelector('input[type="password"]');
    const userField = page.locator('input[type="text"]').first();
    if (await userField.count()) { await userField.fill(''); await userField.type(USER); }
    await page.locator('input[type="password"]').fill(PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.locator('input[type="submit"], input[value="Entrar"], button:has-text("Entrar")').first().click(),
    ]);
    LOG('login enviado');

    // 3) Lista de workbooks -> abrir la hoja EXACTA "Tiempo Acumulado"
    await page.waitForSelector('text=TIEMPO ACUMULADO', { timeout: 60000 });
    // expandir todo para revelar las hojas
    await page.locator('a:has-text("Ampliar Todo")').first().click().catch(() => {});
    await page.waitForTimeout(2500);
    // click en la hoja exacta (evita el workbook "TIEMPO ACUMULADO - SIMPLEMENTE EVITA")
    const hoja = page.getByRole('link', { name: 'Tiempo Acumulado', exact: true });
    await hoja.waitFor({ timeout: 30000 });
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      hoja.click(),
    ]);
    await page.waitForTimeout(3500);
    LOG('worksheet abierto -> ' + page.url().slice(0, 70));

    // 4) Elegir Año Calendario = año en curso (por texto). Espera a que exista el combo del año.
    let anioOk = false;
    for (let intento = 1; intento <= 8 && !anioOk; intento++) {
      const combos = page.locator('select');
      const n = await combos.count();
      for (let i = 0; i < n; i++) {
        const opts = (await combos.nth(i).locator('option').allInnerTexts()).map(x => x.trim());
        if (opts.includes(ANIO)) {
          await combos.nth(i).selectOption({ label: ANIO });
          anioOk = true;
          LOG(`Año Calendario -> ${ANIO}`);
          break;
        }
      }
      if (!anioOk) await page.waitForTimeout(1500);
    }
    if (!anioOk) throw new Error(`No encontré el año ${ANIO} en ningún combo (¿no abrió la hoja?)`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);

    // 5a) Exportar (acción de la hoja) -> pantalla "Seleccionar Tipo de Exportación"
    await page.locator('a:has-text("Exportar")').first().click();
    await page.waitForSelector('text=Seleccionar Tipo de Exportación', { timeout: 45000 });
    await page.waitForTimeout(1000);
    LOG('pantalla Seleccionar Tipo de Exportación');
    // asegurar formato Excel (viene por defecto "Libro de Trabajo de Microsoft Excel")
    const fmt = page.locator('select').first();
    if (await fmt.count()) {
      const opts = (await fmt.locator('option').allInnerTexts()).map(x => x.toLowerCase());
      const idx = opts.findIndex(o => o.includes('excel') || o.includes('xls'));
      if (idx >= 0) await fmt.selectOption({ index: idx }).catch(() => {});
    }
    // helper: clickear en CUALQUIER frame el link/boton cuya etiqueta matchee.
    // Los botones de Discoverer son <a><img alt="Exportar">...</a> (sin texto), así que
    // tomamos value / textContent / title propios O el alt/title de la <img> interna.
    const clickEnFrames = async (re, intentos = 10) => {
      for (let t = 0; t < intentos; t++) {
        for (const fr of page.frames()) {
          const c = fr.locator('input, button, a');
          const cc = await c.count().catch(() => 0);
          for (let i = 0; i < cc; i++) {
            const el = c.nth(i);
            const label = await el.evaluate(e => {
              const own = (e.value || e.textContent || e.title || '').replace(/\s+/g, ' ').trim();
              if (own) return own;
              const img = e.querySelector && e.querySelector('img');
              return img ? ((img.getAttribute('alt') || img.getAttribute('title') || '').trim()) : '';
            }).catch(() => '');
            if (re.test(label)) { await el.click().catch(() => {}); return label; }
          }
        }
        await page.waitForTimeout(1200);
      }
      return null;
    };

    // 5b) botón "Exportar" de la pantalla de tipo -> "Exportación Preparada"
    await page.waitForTimeout(2500);
    const lbl = await clickEnFrames(/^exportar$/i);
    if (!lbl) {
      LOG(`NO encontré Exportar. frames=${page.frames().length}. Vuelco HTML de frames.`);
      let fi = 0;
      for (const fr of page.frames()) {
        try { fs.writeFileSync(path.join(DIR, `bajar_frame${fi}.html`), await fr.content()); } catch {}
        fi++;
      }
      throw new Error('No encontré "Exportar" (ver bajar_frame0.html / bajar_frame1.html)');
    }
    LOG(`click Exportar: "${lbl}"`);
    await page.waitForTimeout(3500);

    // 6) "Exportación Preparada" -> botón descargar (en cualquier frame)
    const dlPromise = page.waitForEvent('download', { timeout: 60000 });
    const lbl2 = await clickEnFrames(/hacer clic para ver o guardar/i);
    if (!lbl2) throw new Error('No encontré el botón de descarga "Hacer clic para ver o guardar"');
    LOG(`click descarga: "${lbl2}"`);
    const download = await dlPromise;
    await download.saveAs(DEST);
    const filas = contarFilas(DEST);
    LOG(`DESCARGADO -> ${DEST} (filas=${filas})`);
    await registrar('ok', `año ${ANIO}`, filas);
    console.log('OK: Tiempo Acumulado bajado a ' + DEST + ' (filas=' + filas + ')');
  } catch (err) {
    LOG('ERROR: ' + err.message);
    try { await page.screenshot({ path: path.join(DIR, 'bajar_error.png'), fullPage: true }); } catch {}
    await registrar('error', err.message, null);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main();
