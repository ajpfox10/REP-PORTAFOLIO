const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { pool } = require('../src/db');
const { launchBrowser, sleep, login, openFarmaciaMs, selectSector } = require('../src/farmaciaWeb');
const { parseConsumoReport } = require('../src/consumoReportParser');
const consumoMs = require('../src/consumoMsDb');
const bajas = require('../src/bajasDb');
const { leerBajasSector } = require('../src/farmaciaBajasWeb');

// Robot de descarga del consumo mensual: Farmacia MS > Reportes > Consumo Comparativo mensual > Excel,
// periodo Anual, un archivo por sector y año. El reporte solo ofrece el sector elegido en la sesion,
// asi que para cada sector se usa "Cambiar Sector".
const REPORTE_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/reportes/consumoComparativoMensual';

function normalizar(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

async function cambiarSector(page, sector) {
  await page.goto(REPORTE_URL, { waitUntil: 'domcontentloaded' });
  await page.click('#change-sector');
  await sleep(1000);
  await selectSector(page.mainFrame(), sector);
}

async function descargarAnio(page, sector, anio, carpeta) {
  await page.goto(REPORTE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#form_anio').waitFor({ state: 'attached', timeout: 30000 });
  const anios = await page.evaluate(() => [...document.querySelector('#form_anio').options].map((o) => o.value).filter(Boolean));
  if (!anios.includes(String(anio))) throw new Error(`El año ${anio} no está disponible en Farmacia MS (hay: ${anios.join(', ')})`);
  await page.selectOption('#form_anio', String(anio));
  await page.selectOption('#form_periodo', 'anual');
  // El combo de sector es un select2 (oculto): se elige el valor directo y se avisa con jQuery
  const valor = await page.evaluate((buscado) => {
    const limpiar = (v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const sel = document.querySelector('#form_sector');
    const op = [...sel.options].find((o) => o.value && o.value !== 'todos' && limpiar(o.textContent).includes(limpiar(buscado)));
    if (!op) return '';
    sel.value = op.value;
    if (window.jQuery) window.jQuery(sel).trigger('change'); else sel.dispatchEvent(new Event('change', { bubbles: true }));
    return op.value;
  }, sector);
  if (!valor) throw new Error(`El reporte no ofrece el sector "${sector}"`);
  await page.check('#form_tipoDescarga_0'); // Excel
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }),
    page.locator('form button').filter({ hasText: /Descargar/i }).first().click()
  ]);
  const destino = path.join(carpeta, `${anio} CONSUMO ${normalizar(sector)}${path.extname(download.suggestedFilename()) || '.xls'}`);
  await download.saveAs(destino);
  return destino;
}

async function main() {
  if (!config.farmacia.user || !config.farmacia.password) {
    throw new Error('Faltan FARMACIA_WEB_USER/FARMACIA_WEB_PASSWORD en el .env del ambiente');
  }
  const sectores = config.stockActual.sectores;
  const anios = String(process.env.CONSUMO_ANIOS || new Date().getFullYear()).split(',').map((a) => Number(a.trim())).filter(Boolean);
  let descargaId = Number(process.env.CONSUMO_DESCARGA_ID || 0);
  if (!descargaId) descargaId = await consumoMs.crearDescarga(anios, sectores, null);
  const carpeta = await consumoMs.carpetaConsumo();
  fs.mkdirSync(carpeta, { recursive: true });

  let browser = null;
  const archivos = [];
  let totalItems = 0;
  let totalBajas = 0;
  try {
    browser = await launchBrowser({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    const page = await context.newPage();
    await consumoMs.actualizarDescarga(descargaId, { mensaje: 'Entrando a Farmacia MS' });
    await login(page);
    await selectSector(await openFarmaciaMs(page), sectores[0]);

    for (const [i, sector] of sectores.entries()) {
      if (i > 0) await cambiarSector(page, sector);
      for (const anio of anios) {
        await consumoMs.actualizarDescarga(descargaId, { mensaje: `Descargando ${sector} ${anio}` });
        console.log(`Descargando consumo ${sector} ${anio}...`);
        const archivo = await descargarAnio(page, sector, anio, carpeta);
        const parsed = parseConsumoReport(archivo);
        await consumoMs.guardarItems(descargaId, sector, anio, parsed.items);
        archivos.push({ sector, anio, archivo, items: parsed.items.length });
        totalItems += parsed.items.length;
        await consumoMs.actualizarDescarga(descargaId, { archivos, total_items: totalItems });
        console.log(`OK ${sector} ${anio}: ${parsed.items.length} productos -> ${archivo}`);
      }
      // Bajas del sector (descartes y vencidos) en el mismo rango que el consumo, para mostrarlas al lado
      const hoy = new Date();
      const desdeAr = `01/01/${Math.min(...anios)}`;
      const hastaAr = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
      const egresos = await leerBajasSector(page, desdeAr, hastaAr, (m) => consumoMs.actualizarDescarga(descargaId, { mensaje: `Bajas de ${sector}: ${m}` }));
      await bajas.guardarBajas(sector, `${Math.min(...anios)}-01-01`, `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`, egresos);
      totalBajas += egresos.reduce((a, e) => a + e.items.length, 0);
      console.log(`OK bajas ${sector}: ${egresos.length} egresos`);
    }

    // Con el consumo nuevo se rearman los trimestres del Analisis Trimestral
    const trimestres = await consumoMs.generarTrimestresDesdeConsumo();
    const actualizados = trimestres.filter((t) => t.cambio).map((t) => `T${t.trimestre} ${t.anio}`);
    console.log(`Analisis Trimestral: ${actualizados.length ? `actualizados ${actualizados.join(', ')}` : 'sin cambios'}`);

    await consumoMs.actualizarDescarga(descargaId, {
      estado: 'ok',
      mensaje: `Descarga completa: ${archivos.length} archivo(s), ${totalItems} filas, ${totalBajas} renglones de bajas. Análisis Trimestral: ${actualizados.length ? `actualizados ${actualizados.join(', ')}` : 'sin cambios'}.`,
      finished_at: new Date()
    });
  } catch (error) {
    await consumoMs.actualizarDescarga(descargaId, {
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
