const fs = require('fs');
const { chromium } = require('playwright');
const config = require('../src/config');
const { pool, query } = require('../src/db');

function getChromeExecutablePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function launchBrowser() {
  const executablePath = getChromeExecutablePath();
  return chromium.launch({
    executablePath: executablePath || undefined,
    headless: process.env.SCRIPT_HEADLESS === '1'
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function getPendientes(importacionId = 0) {
  const where = ["v.estado = 'listo'"];
  const params = {};
  if (importacionId) {
    where.push('i.importacion_id = :importacionId');
    params.importacionId = importacionId;
  }
  return query(`
    SELECT v.id valor_id, i.id item_id, i.codigo_articulo, i.descripcion,
           v.stock_minimo_nuevo, v.stock_maximo_nuevo, v.tipo_operacion
    FROM stock_valores_carga v
    JOIN stock_items i ON i.id = v.item_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.fila_reporte
    LIMIT 500
  `, params);
}

async function marcarResultado(valorId, estado, mensaje = null) {
  await query(
    `UPDATE stock_valores_carga
     SET estado = :estado, mensaje_error = :mensaje
     WHERE id = :valorId`,
    { valorId, estado, mensaje }
  );
}

async function crearRun(importacionId = null) {
  const insert = await query(
    `INSERT INTO stock_script_runs (importacion_id, estado, mensaje)
     VALUES (:importacionId, 'iniciado', 'Ejecucion manual desde consola')`,
    { importacionId }
  );
  return insert.insertId;
}

async function actualizarRun(runId, patch) {
  if (!runId) return;
  const fields = [];
  const params = { runId };
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = :${key}`);
    params[key] = value;
  }
  if (!fields.length) return;
  await query(
    `UPDATE stock_script_runs
     SET ${fields.join(', ')}
     WHERE id = :runId`,
    params
  );
}

async function waitForFrameByUrl(page, pattern, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = page.frames().find((entry) => pattern.test(entry.url()));
    if (frame) return frame;
    await page.waitForTimeout(300);
  }
  throw new Error(`No se encontro el frame esperado: ${pattern}`);
}

async function openFarmaciaMs(page) {
  if (page.url().includes('/farmaciams/')) return page.mainFrame();
  // Portal nuevo: /intranet/sistemas/ (sin frames). Se clickea "Farmacia MS" en la pagina principal.
  await page.getByText(/Farmacia MS/i).first().click({ timeout: 20000 });
  await page.waitForURL(/\/farmaciams\//i, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return page.mainFrame();
}

async function selectSector(appFrame) {
  const sectorText = config.farmacia.sector;
  // El selector de sector ahora es un modal SweetAlert2 (.swal2-select + .swal2-confirm).
  const swalSelect = appFrame.locator('.swal2-select');
  const haySwal = await swalSelect.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!haySwal) return; // ya hay sector elegido en la sesion

  const matchedValue = await swalSelect.evaluate((node, desired) => {
    const clean = (value) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const wanted = clean(desired);
    const option = Array.from(node.options).find((entry) => clean(entry.textContent).includes(wanted));
    return option ? option.value : '';
  }, sectorText);
  if (!matchedValue) {
    const available = await swalSelect.evaluate((node) =>
      Array.from(node.options).map((entry) => entry.textContent.trim()).filter(Boolean)
    );
    throw new Error(`No se encontro el sector configurado "${sectorText}". Sectores visibles: ${available.join(' | ')}`);
  }

  await swalSelect.selectOption(matchedValue);
  await appFrame.locator('.swal2-confirm').click().catch(() => {});
  await sleep(1500);
  // posible segundo modal de confirmacion
  await appFrame.locator('.swal2-confirm').click({ timeout: 3000 }).catch(() => {});
  await sleep(1200);
}

async function getLoginFrame(page) {
  for (const frame of page.frames()) {
    const username = frame.locator('#username, input[name="username"], input[type="text"], input:not([type])').first();
    if (await username.count().catch(() => 0)) return frame;
  }
  return page.mainFrame();
}

async function waitForLoginFrame(page, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = await getLoginFrame(page);
    const username = frame.locator('#username, input[name="username"], input[type="text"], input:not([type])').first();
    if (await username.count().catch(() => 0)) return frame;
    await page.waitForTimeout(300);
  }
  throw new Error('No se encontro el formulario de login de Farmacia');
}

async function login(page) {
  await page.goto(config.farmacia.url, { waitUntil: 'domcontentloaded' });
  const frame = await waitForLoginFrame(page);
  await frame.locator('#username, input[name="username"], input[type="text"], input:not([type])').first().fill(config.farmacia.user);
  await frame.locator('#password, input[name="password"], input[type="password"]').first().fill(config.farmacia.password);
  const iniciar = frame.locator('form button[type="submit"], form input[type="submit"], button[type="submit"], input[type="submit"]').first();
  if (await iniciar.count()) await iniciar.click();
  else await frame.locator('#password, input[name="password"], input[type="password"]').first().press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);
}

const STOCK_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/stock/';

async function openStockCritico(page) {
  // El sector ya fue elegido una vez en main(). Se va directo a Stock Critico.
  await page.goto(STOCK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(1200);
  const stockFrame = page.mainFrame();
  await stockFrame.locator('input[name="desarrollobundle_paginadoformtype[filtros][codArticulo]"], input[id$="_filtros_codArticulo"]').first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(async (error) => {
      const text = await stockFrame.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      throw new Error(`No se encontro el campo Codigo Articulo en Stock Critico. URL=${stockFrame.url()}. Texto=${text.slice(0, 500)}. Detalle=${error.message}`);
    });
  return stockFrame;
}

async function cargarItem(page, item) {
  const appFrame = await openStockCritico(page);
  const codigoInput = appFrame.locator('input[name="desarrollobundle_paginadoformtype[filtros][codArticulo]"], input[id$="_filtros_codArticulo"]').first();
  await codigoInput.waitFor({ state: 'visible', timeout: 15000 });
  await codigoInput.fill(item.codigo_articulo);
  await appFrame.locator('button[id^="buscar-form"], button').filter({ hasText: /buscar/i }).first().click();
  await sleep(1200);
  const row = appFrame.locator('tr').filter({ hasText: item.codigo_articulo }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const editHref = await row.locator('a').filter({ hasText: /modificar/i }).first().getAttribute('href');
  if (!editHref) throw new Error(`No se encontro accion Modificar para ${item.codigo_articulo}`);
  await appFrame.goto(new URL(editHref, appFrame.url()).toString(), { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  const minimo = appFrame.locator('input[name="stock[stockMinimo]"], #stock_stockMinimo').first();
  const maximo = appFrame.locator('input[name="stock[stockCritico]"], #stock_stockCritico').first();
  await minimo.waitFor({ state: 'visible', timeout: 15000 });
  await maximo.waitFor({ state: 'visible', timeout: 15000 });
  if (item.stock_minimo_nuevo != null) {
    await minimo.fill(String(item.stock_minimo_nuevo));
  }
  if (item.stock_maximo_nuevo != null) {
    await maximo.fill(String(item.stock_maximo_nuevo));
  }
  const guardar = appFrame.getByRole('button', { name: /guardar|aceptar|modificar/i }).first();
  await guardar.waitFor({ state: 'visible', timeout: 15000 });
  if (process.env.SCRIPT_DRY_RUN) {
    console.log(`DRY ${item.codigo_articulo}: min=${item.stock_minimo_nuevo} max=${item.stock_maximo_nuevo} (NO se guarda)`);
    return;
  }
  await guardar.click();
  await sleep(1200);
}

async function main() {
  if (!config.scriptToken) throw new Error('Falta SCRIPT_TOKEN');
  if (!config.farmacia.user || !config.farmacia.password) {
    throw new Error('Faltan FARMACIA_WEB_USER/FARMACIA_WEB_PASSWORD en el .env del ambiente');
  }

  const importacionId = Number(process.env.SCRIPT_IMPORTACION_ID || 0);
  let runId = Number(process.env.SCRIPT_RUN_ID || 0);
  if (!runId) runId = await crearRun(importacionId || null);
  let procesados = 0;
  let cargados = 0;
  let errores = 0;
  let browser = null;

  try {
    const pendientes = await getPendientes(importacionId);
    const scope = importacionId ? `importacion #${importacionId}` : 'todas las importaciones';
    console.log(`Pendientes listos para cargar (${scope}): ${pendientes.length}`);
    await actualizarRun(runId, { mensaje: `Pendientes listos para cargar (${scope}): ${pendientes.length}` });
    if (!pendientes.length) {
      await actualizarRun(runId, {
        estado: 'finalizado',
        procesados,
        cargados,
        errores,
        mensaje: 'No habia productos listos para cargar',
        finished_at: new Date()
      });
      return;
    }

    const dryRun = Boolean(process.env.SCRIPT_DRY_RUN);
    const limit = Number(process.env.SCRIPT_LIMIT || 0);
    const lista = limit > 0 ? pendientes.slice(0, limit) : pendientes;
    if (dryRun) console.log(`*** DRY RUN: no se guarda nada. Items a recorrer: ${lista.length} ***`);

    browser = await launchBrowser();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await login(page);
    // Portal nuevo: entrar a Farmacia MS y elegir sector una sola vez.
    const appFrame = await openFarmaciaMs(page);
    await selectSector(appFrame);

    for (const item of lista) {
      try {
        if (!dryRun) await marcarResultado(item.valor_id, 'en_proceso');
        await cargarItem(page, item);
        if (!dryRun) await marcarResultado(item.valor_id, 'cargado');
        procesados += 1;
        cargados += 1;
        const accion = dryRun ? 'DRY-OK' : (item.tipo_operacion === 'actualizacion' ? 'Actualizado' : 'Cargado');
        await actualizarRun(runId, { procesados, cargados, errores, mensaje: `${accion} ${item.codigo_articulo}` });
        console.log(`OK ${accion} ${item.codigo_articulo}`);
      } catch (error) {
        procesados += 1;
        errores += 1;
        if (!dryRun) await marcarResultado(item.valor_id, 'error', error.message);
        await actualizarRun(runId, { procesados, cargados, errores, mensaje: `Error ${item.codigo_articulo}: ${error.message}` });
        console.error(`ERROR ${item.codigo_articulo}: ${error.message}`);
      }
    }

    await actualizarRun(runId, {
      estado: 'finalizado',
      procesados,
      cargados,
      errores,
      mensaje: `Finalizado. Cargados: ${cargados}. Errores: ${errores}.`,
      finished_at: new Date()
    });
  } catch (error) {
    await actualizarRun(runId, {
      estado: 'error',
      procesados,
      cargados,
      errores,
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
