const fs = require('fs');
const { chromium } = require('playwright');
const config = require('./config');

// Navegacion comun de Farmacia MS (login, entrada al sistema y eleccion de sector).
// La usan el robot de carga de stock critico y el de descarga de stock.

function getChromeExecutablePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function launchBrowser({ headless = process.env.SCRIPT_HEADLESS === '1' } = {}) {
  const executablePath = getChromeExecutablePath();
  return chromium.launch({
    executablePath: executablePath || undefined,
    headless
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// credenciales: { user, password } (por defecto el usuario principal del .env)
async function login(page, credenciales = config.farmacia) {
  await page.goto(config.farmacia.url, { waitUntil: 'domcontentloaded' });
  const frame = await waitForLoginFrame(page);
  await frame.locator('#username, input[name="username"], input[type="text"], input:not([type])').first().fill(credenciales.user);
  await frame.locator('#password, input[name="password"], input[type="password"]').first().fill(credenciales.password);
  const iniciar = frame.locator('form button[type="submit"], form input[type="submit"], button[type="submit"], input[type="submit"]').first();
  if (await iniciar.count()) await iniciar.click();
  else await frame.locator('#password, input[name="password"], input[type="password"]').first().press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);
}

async function openFarmaciaMs(page) {
  if (page.url().includes('/farmaciams/')) return page.mainFrame();
  // Portal nuevo: /intranet/sistemas/ (sin frames). Se clickea "Farmacia MS" en la pagina principal.
  await page.getByText(/Farmacia MS/i).first().click({ timeout: 20000 });
  await page.waitForURL(/\/farmaciams\//i, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return page.mainFrame();
}

async function selectSector(appFrame, sectorText = config.farmacia.sector) {
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

module.exports = { launchBrowser, sleep, waitForFrameByUrl, login, openFarmaciaMs, selectSector };
