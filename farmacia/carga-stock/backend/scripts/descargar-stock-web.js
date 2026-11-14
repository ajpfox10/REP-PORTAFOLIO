const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../src/config');
const { pool } = require('../src/db');
const { launchBrowser, sleep, login, openFarmaciaMs, selectSector } = require('../src/farmaciaWeb');
const stockActual = require('../src/stockActualDb');

// Robot de descarga del stock actual: Farmacia MS > Reportes > Consulta de Stock > Excel,
// un archivo por sector, con la fecha de hoy. Guarda los Excel en la carpeta configurada
// (la elegida en el portal o STOCK_ACTUAL_DIR) y los carga en stock_actual_items.
const REPORTE_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/reportes/stock';

function normalizar(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function fechaHoy() {
  const hoy = new Date();
  const dd = String(hoy.getDate()).padStart(2, '0');
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  return { ar: `${dd}/${mm}/${hoy.getFullYear()}`, iso: `${hoy.getFullYear()}-${mm}-${dd}` };
}

async function descargarSector(page, sector, destinoDir) {
  await page.goto(REPORTE_URL, { waitUntil: 'domcontentloaded' });
  const select = page.locator('#form_sector');
  await select.waitFor({ state: 'attached', timeout: 30000 });
  const valor = await select.evaluate((node, buscado) => {
    const limpiar = (v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const opcion = Array.from(node.options).find((o) => o.value && limpiar(o.textContent) === limpiar(buscado))
      || Array.from(node.options).find((o) => o.value && limpiar(o.textContent).includes(limpiar(buscado)));
    return opcion ? opcion.value : '';
  }, sector);
  if (!valor) {
    const disponibles = await select.evaluate((node) => Array.from(node.options).filter((o) => o.value).map((o) => o.textContent.trim()));
    throw new Error(`No existe el sector "${sector}" en Consulta de Stock. Disponibles: ${disponibles.join(' | ')}`);
  }
  await select.selectOption(valor);
  // La fecha es obligatoria (stock calculado hasta ese dia); se usa la de hoy.
  const fecha = fechaHoy();
  await page.evaluate((f) => { document.querySelector('#form_fecha').value = f; }, fecha.ar);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }),
    page.click('#excel')
  ]);
  const extension = path.extname(download.suggestedFilename()) || '.xls';
  const destino = path.join(destinoDir, `${fecha.iso} Stock ${normalizar(sector)}${extension}`);
  await download.saveAs(destino);
  return destino;
}

// Ingresos Detallados del sector (tipo de ingreso y origen: O.C., otra institucion, otro sector...),
// por semestres desde el 1/1 del anio anterior hasta hoy. Sirve para rastrear los codigos repetidos.
const INGRESOS_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/reportes/ingresos/detalles';

function tramosIngresos() {
  const hoy = new Date();
  const out = [];
  for (let anio = hoy.getFullYear() - 1; anio <= hoy.getFullYear(); anio += 1) {
    for (const [ini, fin] of [[[0, 1], [5, 30]], [[6, 1], [11, 31]]]) {
      const desde = new Date(anio, ini[0], ini[1]);
      if (desde > hoy) continue;
      let hasta = new Date(anio, fin[0], fin[1]);
      if (hasta > hoy) hasta = hoy;
      out.push([desde, hasta]);
    }
  }
  return out;
}

async function descargarIngresosSector(page, sector, destinoDir) {
  const dd = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const filas = [];
  for (const [desde, hasta] of tramosIngresos()) {
    await page.goto(INGRESOS_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#form_sector').waitFor({ state: 'attached', timeout: 30000 });
    const ok = await page.evaluate(({ buscado, d, h }) => {
      const limpiar = (v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
      const sel = document.querySelector('#form_sector');
      const op = [...sel.options].find((o) => o.value && limpiar(o.textContent) === limpiar(buscado));
      if (!op) return false;
      sel.value = op.value;
      if (window.jQuery) window.jQuery(sel).trigger('change');
      for (const [id, v] of [['#form_fechaDesde', d], ['#form_fechaHasta', h]]) {
        const el = document.querySelector(id);
        el.value = v;
        if (window.jQuery) window.jQuery(el).trigger('change');
      }
      return true;
    }, { buscado: sector, d: dd(desde), h: dd(hasta) });
    if (!ok) throw new Error(`No existe el sector "${sector}" en Ingresos Detallados`);
    await sleep(800);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 600000 }),
      page.click('#excel')
    ]);
    const archivo = path.join(destinoDir, `ingresos-${normalizar(sector).replace(/[^A-Z0-9]+/g, '_')}-${desde.getTime()}.xls`);
    await download.saveAs(archivo);
    filas.push(...stockActual.parseIngresosExcel(archivo));
    fs.unlinkSync(archivo);
  }
  return filas;
}

async function main() {
  if (!config.farmacia.user || !config.farmacia.password) {
    throw new Error('Faltan FARMACIA_WEB_USER/FARMACIA_WEB_PASSWORD en el .env del ambiente');
  }
  const sectores = config.stockActual.sectores;
  let descargaId = Number(process.env.STOCK_DESCARGA_ID || 0);
  if (!descargaId) descargaId = await stockActual.crearDescarga(sectores, null);
  const carpeta = await stockActual.carpetaDescarga();
  fs.mkdirSync(carpeta, { recursive: true });

  let browser = null;
  const archivos = [];
  let totalItems = 0;
  let fechaStock = null;
  try {
    browser = await launchBrowser({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    const page = await context.newPage();
    await stockActual.actualizarDescarga(descargaId, { mensaje: 'Entrando a Farmacia MS' });
    await login(page);
    await selectSector(await openFarmaciaMs(page));

    for (const sector of sectores) {
      await stockActual.actualizarDescarga(descargaId, { mensaje: `Descargando ${sector}` });
      console.log(`Descargando stock de ${sector}...`);
      const archivo = await descargarSector(page, sector, carpeta);
      const parsed = stockActual.parseStockExcel(archivo);
      await stockActual.guardarItemsSector(descargaId, sector, parsed);
      archivos.push({ sector, archivo, items: parsed.items.length });
      totalItems += parsed.items.length;
      fechaStock = parsed.fechaStock || fechaStock;
      await stockActual.actualizarDescarga(descargaId, { archivos, total_items: totalItems, fecha_stock: fechaStock });
      console.log(`OK ${sector}: ${parsed.items.length} productos -> ${archivo}`);
      await sleep(500);
    }

    // Ingresos Detallados (no frena la descarga de stock si falla)
    let avisoIngresos = '';
    const tmpIngresos = path.join(os.tmpdir(), `farmacia-ingresos-${descargaId}`);
    fs.mkdirSync(tmpIngresos, { recursive: true });
    for (const sector of sectores) {
      try {
        await stockActual.actualizarDescarga(descargaId, { mensaje: `Bajando ingresos de ${sector}` });
        const ingresos = await descargarIngresosSector(page, sector, tmpIngresos);
        await stockActual.guardarIngresosSector(descargaId, sector, ingresos);
        console.log(`OK ingresos ${sector}: ${ingresos.length} filas`);
      } catch (error) {
        console.error(`No se pudieron bajar los ingresos de ${sector}: ${error.message}`);
        avisoIngresos = ` (no se pudieron bajar los ingresos de ${sector})`;
      }
    }

    await stockActual.actualizarDescarga(descargaId, {
      estado: 'ok',
      mensaje: `Descarga completa: ${totalItems} productos en ${archivos.length} sector(es).${avisoIngresos}`,
      finished_at: new Date()
    });
  } catch (error) {
    await stockActual.actualizarDescarga(descargaId, {
      estado: 'error',
      archivos,
      total_items: totalItems,
      mensaje: error.message,
      finished_at: new Date()
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
