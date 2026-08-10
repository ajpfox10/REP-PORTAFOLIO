import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const loginUrl = process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

async function clickByText(page, texts, label) {
  let lastError = null;
  for (const text of texts) {
    const locators = [
      page.getByRole('button', { name: text, exact: false }),
      page.getByRole('link', { name: text, exact: false }),
      page.getByText(text, { exact: false }),
      page.locator(`button:has-text("${text}")`),
      page.locator(`a:has-text("${text}")`),
    ];

    for (const locator of locators) {
      try {
        const count = await locator.count();
        if (!count) continue;
        await locator.first().click({ timeout: 15000 });
        console.log(`Click OK: ${label} -> ${text}`);
        return;
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError || new Error(`No encontre ${label}`);
}

async function clickVisibleCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No pude ubicar visualmente ${label}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(700);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  console.log(`Click fisico OK: ${label} (${Math.round(x)}, ${Math.round(y)})`);
}

const browser = await chromium.launch({
  channel: process.env.ART_BROWSER_CHANNEL || 'chrome',
  headless: false,
  slowMo: 400,
  args: ['--start-maximized'],
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

try {
  console.log('Abriendo login Provincia ART...');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  const visibleInputs = page.locator('input:not([type="hidden"]):not([readonly])');
  await visibleInputs.nth(0).fill(requiredEnv('ART_PROVINCIA_USER'));
  await visibleInputs.nth(1).fill(requiredEnv('ART_PROVINCIA_PASSWORD'));
  console.log('Usuario y contrasena cargados.');

  const loginButton = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first();
  await clickVisibleCenter(page, loginButton, 'Iniciar sesion');
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log(`Post-login URL: ${page.url()}`);

  await page.locator('#menu_21').click({ timeout: 15000 });
  console.log('Click OK: Mi contrato -> #menu_21');
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  await page.locator('#linkSubmenu_422').click({ timeout: 15000 });
  console.log('Click OK: Trabajadores -> #linkSubmenu_422');
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  console.log(`Quede en Mis trabajadores: ${page.url()}`);
  console.log('No hago nada mas. Ventana abierta 2 horas.');
  await page.waitForTimeout(2 * 60 * 60 * 1000);
} catch (err) {
  const screenshot = 'C:/apps/personaldev/apipersonal/logs/art/visible_mis_trabajadores_error.png';
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  console.error(`${err?.message || err}. Captura: ${screenshot}`);
  console.error('No hago nada mas. Ventana abierta 2 horas para revisar.');
  await page.waitForTimeout(2 * 60 * 60 * 1000);
}
