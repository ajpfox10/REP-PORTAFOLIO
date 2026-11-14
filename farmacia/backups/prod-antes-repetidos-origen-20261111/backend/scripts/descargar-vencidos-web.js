const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { pool } = require('../src/db');
const { launchBrowser, sleep, login, openFarmaciaMs, selectSector } = require('../src/farmaciaWeb');
const vencidos = require('../src/vencidosDb');

// Robot de descarga de vencimientos: Farmacia MS > Reportes > Articulos Vencidos y Proximos a Vencer > Excel,
// un archivo por sector, con los lotes que vencen hasta la fecha "hasta" (hoy + horizonte elegido).
const REPORTE_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/reportes/vencidosYPorVencer';

function normalizar(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

async function descargarSector(page, sector, hastaAr, carpeta, prefijo) {
  await page.goto(REPORTE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#form_sector').waitFor({ state: 'attached', timeout: 30000 });
  const valor = await page.evaluate(({ buscado, fecha }) => {
    const limpiar = (v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const sel = document.querySelector('#form_sector');
    const op = [...sel.options].find((o) => o.value && limpiar(o.textContent) === limpiar(buscado))
      || [...sel.options].find((o) => o.value && limpiar(o.textContent).includes(limpiar(buscado)));
    if (!op) return '';
    sel.value = op.value;
    if (window.jQuery) window.jQuery(sel).trigger('change');
    document.querySelector('#form_fecha').value = fecha;
    return op.value;
  }, { buscado: sector, fecha: hastaAr });
  if (!valor) throw new Error(`El reporte de vencidos no ofrece el sector "${sector}"`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }),
    page.click('button.descargar[data-tipodescarga="excel"]')
  ]);
  const destino = path.join(carpeta, `${prefijo} Vencidos ${normalizar(sector)}${path.extname(download.suggestedFilename()) || '.xls'}`);
  await download.saveAs(destino);
  return destino;
}

async function main() {
  if (!config.farmacia.user || !config.farmacia.password) {
    throw new Error('Faltan FARMACIA_WEB_USER/FARMACIA_WEB_PASSWORD en el .env del ambiente');
  }
  const sectores = config.stockActual.sectores;
  const meses = Math.max(1, Math.min(60, Number(process.env.VENC_MESES || 6)));
  const hoy = new Date();
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + meses, hoy.getDate());
  const dosDigitos = (n) => String(n).padStart(2, '0');
  const hastaIso = `${hasta.getFullYear()}-${dosDigitos(hasta.getMonth() + 1)}-${dosDigitos(hasta.getDate())}`;
  const hastaAr = `${dosDigitos(hasta.getDate())}/${dosDigitos(hasta.getMonth() + 1)}/${hasta.getFullYear()}`;
  const hoyIso = `${hoy.getFullYear()}-${dosDigitos(hoy.getMonth() + 1)}-${dosDigitos(hoy.getDate())}`;

  let descargaId = Number(process.env.VENC_DESCARGA_ID || 0);
  if (!descargaId) descargaId = await vencidos.crearDescarga(sectores, hastaIso, null);
  const carpeta = await vencidos.carpetaVencidos();
  fs.mkdirSync(carpeta, { recursive: true });

  let browser = null;
  const archivos = [];
  let totalItems = 0;
  try {
    browser = await launchBrowser({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    const page = await context.newPage();
    await vencidos.actualizarDescarga(descargaId, { mensaje: 'Entrando a Farmacia MS' });
    await login(page);
    await selectSector(await openFarmaciaMs(page));

    for (const sector of sectores) {
      await vencidos.actualizarDescarga(descargaId, { mensaje: `Descargando ${sector}` });
      console.log(`Descargando vencidos de ${sector} hasta ${hastaAr}...`);
      const archivo = await descargarSector(page, sector, hastaAr, carpeta, `${hoyIso} (hasta ${hastaIso})`);
      const parsed = vencidos.parseVencidosExcel(archivo);
      await vencidos.guardarItems(descargaId, sector, parsed.items);
      archivos.push({ sector, archivo, items: parsed.items.length });
      totalItems += parsed.items.length;
      await vencidos.actualizarDescarga(descargaId, { archivos, total_items: totalItems });
      console.log(`OK ${sector}: ${parsed.items.length} lotes -> ${archivo}`);
      await sleep(500);
    }

    await vencidos.actualizarDescarga(descargaId, {
      estado: 'ok',
      mensaje: `Descarga completa: ${totalItems} lotes que vencen hasta el ${hastaAr}, en ${archivos.length} sector(es).`,
      finished_at: new Date()
    });
  } catch (error) {
    await vencidos.actualizarDescarga(descargaId, {
      estado: 'error', archivos, total_items: totalItems, mensaje: error.message, finished_at: new Date()
    });
    throw error;
  } finally {
    if (browser) await browser.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
