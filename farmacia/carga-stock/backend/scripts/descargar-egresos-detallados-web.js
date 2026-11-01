// Descarga (solo lectura) el reporte Egresos Detallados de Farmacia MS en Excel, por tramos de fechas.
// Variables: EGR_SECTOR (texto del sector), EGR_DESDE / EGR_HASTA (aaaa-mm-dd), EGR_TRAMO ('anio' | 'semestre' | 'mes'),
// EGR_DIR (carpeta destino). Si un tramo falla o tarda demasiado, se parte en meses.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const fs = require('fs');
const path = require('path');
const { launchBrowser, login, openFarmaciaMs, selectSector, sleep } = require('../src/farmaciaWeb');

const SECTOR = process.env.EGR_SECTOR || 'DISPENSA AMBULATORIO';
const DESDE = process.env.EGR_DESDE || '2003-01-01';
const HASTA = process.env.EGR_HASTA || '2025-06-30';
const TRAMO = process.env.EGR_TRAMO || 'anio';
const DIR = process.env.EGR_DIR || 'D:\\FARMACIA\\EGRESOS DETALLADOS';
const URL_REPORTE = 'https://sistemas.ms.gba.gov.ar/farmaciams/reportes/egresos/detalles';
const ESPERA_DESCARGA = Number(process.env.EGR_ESPERA_MS || 15 * 60 * 1000);

const dos = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const ar = (d) => `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
const fecha = (s) => new Date(`${s}T00:00:00`);

function tramos(desde, hasta, tipo) {
  const out = [];
  let ini = fecha(desde);
  const fin = fecha(hasta);
  while (ini <= fin) {
    let corte;
    if (tipo === 'mes') corte = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
    else if (tipo === 'semestre') corte = new Date(ini.getFullYear(), ini.getMonth() < 6 ? 6 : 12, 0);
    else corte = new Date(ini.getFullYear(), 11, 31);
    if (corte > fin) corte = fin;
    out.push([new Date(ini), corte]);
    ini = new Date(corte.getFullYear(), corte.getMonth(), corte.getDate() + 1);
  }
  return out;
}

async function descargarTramo(page, ini, fin) {
  const archivo = path.join(DIR, `Egresos detallados ${SECTOR} ${iso(ini)} a ${iso(fin)}.xls`);
  if (fs.existsSync(archivo) && fs.statSync(archivo).size > 0) return { archivo, omitido: true };
  await page.goto(URL_REPORTE, { waitUntil: 'domcontentloaded' });
  await page.locator('#form_sector').waitFor({ state: 'attached', timeout: 30000 });
  const sectorOk = await page.evaluate(({ sector, d, h }) => {
    const sel = document.querySelector('#form_sector');
    const op = [...sel.options].find((o) => o.textContent.trim().toUpperCase() === sector.toUpperCase());
    if (!op) return false;
    sel.value = op.value;
    if (window.jQuery) window.jQuery(sel).trigger('change');
    for (const [id, v] of [['#form_fechaDesde', d], ['#form_fechaHasta', h]]) {
      const el = document.querySelector(id);
      el.value = v;
      if (window.jQuery) window.jQuery(el).trigger('change');
    }
    return true;
  }, { sector: SECTOR, d: ar(ini), h: ar(fin) });
  if (!sectorOk) throw new Error(`El reporte no tiene el sector ${SECTOR}`);
  await sleep(800);
  const espera = page.waitForEvent('download', { timeout: ESPERA_DESCARGA });
  await page.click('#excel');
  const descarga = await espera;
  await descarga.saveAs(archivo);
  return { archivo, omitido: false };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await launchBrowser({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const resumen = [];
  try {
    await login(page);
    const app = await openFarmaciaMs(page);
    await selectSector(app, SECTOR);
    const pendientes = tramos(DESDE, HASTA, TRAMO);
    while (pendientes.length) {
      const [ini, fin] = pendientes.shift();
      const t0 = Date.now();
      try {
        const r = await descargarTramo(page, ini, fin);
        const kb = Math.round(fs.statSync(r.archivo).size / 1024);
        console.log(`OK ${ar(ini)} a ${ar(fin)}: ${kb} KB${r.omitido ? ' (ya estaba)' : ''} en ${Math.round((Date.now() - t0) / 1000)} s`);
        resumen.push({ desde: iso(ini), hasta: iso(fin), kb, archivo: r.archivo });
      } catch (err) {
        const esMes = ini.getMonth() === fin.getMonth() && ini.getFullYear() === fin.getFullYear();
        console.log(`FALLA ${ar(ini)} a ${ar(fin)}: ${err.message.split('\n')[0]}${esMes ? '' : ' -> se parte en meses'}`);
        if (!esMes) pendientes.unshift(...tramos(iso(ini), iso(fin), 'mes'));
        else resumen.push({ desde: iso(ini), hasta: iso(fin), error: err.message.split('\n')[0] });
      }
    }
  } catch (err) {
    console.error('ERROR', err.message);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(DIR, `resumen descarga ${SECTOR}.json`), JSON.stringify(resumen, null, 1));
    await browser.close();
  }
})();
