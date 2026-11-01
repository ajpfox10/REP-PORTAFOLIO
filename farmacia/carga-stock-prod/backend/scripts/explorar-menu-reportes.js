// Exploracion (solo lectura): lista todos los enlaces del menu de Farmacia MS en un sector.
const { launchBrowser, login, openFarmaciaMs, selectSector, sleep } = require('../src/farmaciaWeb');

(async () => {
  const browser = await launchBrowser({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    await login(page);
    const app = await openFarmaciaMs(page);
    await selectSector(app, process.env.EGR_SECTOR || 'DISPENSA AMBULATORIO');
    await sleep(1500);
    const links = await page.evaluate(() => [...document.querySelectorAll('a')]
      .map((a) => `${a.getAttribute('href') || ''} | ${(a.textContent || '').replace(/\s+/g, ' ').trim()}`)
      .filter((x) => !x.startsWith(' |') && !x.startsWith('# |')));
    console.log(links.join('\n'));
  } catch (err) {
    console.error('ERROR', err.message);
  } finally {
    await browser.close();
  }
})();
