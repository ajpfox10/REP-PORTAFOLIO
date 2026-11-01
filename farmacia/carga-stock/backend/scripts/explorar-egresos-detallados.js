// Exploracion (solo lectura) del reporte Egresos Detallados en el sector Dispensa anterior a 2025.
// Deja una captura y la lista de campos del formulario para armar el robot de descarga.
const path = require('path');
const { launchBrowser, login, openFarmaciaMs, selectSector, sleep } = require('../src/farmaciaWeb');

const SECTOR = process.env.EGR_SECTOR || 'anterior';
const SALIDA = process.env.EGR_SALIDA || '.';

(async () => {
  const browser = await launchBrowser({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    await login(page);
    const app = await openFarmaciaMs(page);
    const sectores = await app.locator('.swal2-select option').allTextContents().catch(() => []);
    console.log('SECTORES:', sectores.map((s) => s.trim()).filter(Boolean).join(' | '));
    await selectSector(app, SECTOR);
    await page.goto('https://sistemas.ms.gba.gov.ar/farmaciams/reportes/egresos/detalles', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const info = await page.evaluate(() => ({
      titulo: document.title,
      sector: (document.body.innerText.match(/Sector[^\n]{0,80}/) || [''])[0],
      campos: [...document.querySelectorAll('input, select, button, textarea')].map((e) => ({
        tag: e.tagName, id: e.id, name: e.name, type: e.type, value: e.value,
        texto: (e.innerText || '').trim().slice(0, 60),
        opciones: e.tagName === 'SELECT' ? [...e.options].slice(0, 40).map((o) => `${o.value}=${o.textContent.trim()}`) : undefined,
        data: Object.assign({}, e.dataset)
      })),
      texto: document.body.innerText.slice(0, 2500)
    }));
    console.log(JSON.stringify(info, null, 1));
    await page.screenshot({ path: path.join(SALIDA, 'egresos-detallados.png'), fullPage: true });
  } catch (err) {
    console.error('ERROR', err.message);
    await page.screenshot({ path: path.join(SALIDA, 'egresos-detallados-error.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
