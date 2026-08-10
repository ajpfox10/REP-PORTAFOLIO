import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const loginUrl = process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

async function clickFirst(page, selectors, timeout = 15000) {
  let lastError = null;
  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.click({ timeout });
      return selector;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`No encontre selector: ${selectors.join(', ')}`);
}

const browser = await chromium.launch({
  channel: process.env.ART_BROWSER_CHANNEL || 'chrome',
  headless: false,
  slowMo: 350,
  args: ['--start-maximized'],
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

try {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('input:not([type="hidden"]):not([readonly])').nth(0).fill(env('ART_PROVINCIA_USER'));
  await page.locator('input:not([type="hidden"]):not([readonly])').nth(1).fill(env('ART_PROVINCIA_PASSWORD'));
  console.log('Login cargado. Hago click en Iniciar sesion.');

  await clickFirst(page, [
    'button:has-text("Iniciar sesión")',
    'button:has-text("Iniciar sesion")',
    'input[type="submit"][value*="Iniciar"]',
    'text=Iniciar sesión',
    'text=Iniciar sesion',
  ]);

  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log('Despues del login:', page.url());

  await clickFirst(page, [
    'text=Mi contrato',
    'text=MI CONTRATO',
    'a:has-text("Mi contrato")',
    'button:has-text("Mi contrato")',
    '[role="button"]:has-text("Mi contrato")',
  ], 30000);

  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  console.log('Quede en Mi contrato:', page.url());
  console.log('Ventana abierta 15 minutos.');
  await page.waitForTimeout(15 * 60 * 1000);
} catch (err) {
  const screenshot = 'C:/apps/personaldev/apipersonal/logs/art/visible_mi_contrato_error.png';
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  console.error(`${err?.message || err}. Captura: ${screenshot}`);
  await page.waitForTimeout(15 * 60 * 1000);
}
