import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';

dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const outDir = 'C:/apps/personaldev/apipersonal/logs/art';
const loginUrl = process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

async function clickVisibleCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No pude ubicar visualmente ${label}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  console.log(`Click fisico OK: ${label} (${Math.round(x)}, ${Math.round(y)})`);
}

async function dumpPage(page, name) {
  await fs.mkdir(outDir, { recursive: true });
  const screenshot = `${outDir}/${name}.png`;
  const mapPath = `${outDir}/${name}.json`;
  await page.screenshot({ path: screenshot, fullPage: true });
  const data = await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const controls = Array.from(document.querySelectorAll('a, button, input, select, textarea, label, [role="button"], [onclick]'))
      .map((el, index) => ({
        index,
        tag: el.tagName,
        type: el.getAttribute('type'),
        text: clean(el.innerText || el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('placeholder')),
        href: el.getAttribute('href'),
        role: el.getAttribute('role'),
        classes: el.getAttribute('class'),
        id: el.getAttribute('id'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
      }))
      .filter((x) => x.text || x.href || x.id || x.name || x.placeholder || x.classes);
    return {
      url: location.href,
      title: document.title,
      bodyText: clean(document.body.innerText).slice(0, 9000),
      controls,
    };
  });
  await fs.writeFile(mapPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ name, url: data.url, title: data.title, screenshot, mapPath }, null, 2));
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
  const visibleInputs = page.locator('input:not([type="hidden"]):not([readonly])');
  await visibleInputs.nth(0).fill(requiredEnv('ART_PROVINCIA_USER'));
  await visibleInputs.nth(1).fill(requiredEnv('ART_PROVINCIA_PASSWORD'));
  await clickVisibleCenter(page, page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first(), 'Iniciar sesion');
  await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(2000);

  await page.locator('#menu_21').click({ timeout: 15000 });
  console.log('Click OK: Mi contrato -> #menu_21');
  await page.waitForTimeout(800);
  await page.locator('#linkSubmenu_422').click({ timeout: 15000 });
  console.log('Click OK: Trabajadores -> #linkSubmenu_422');
  await page.waitForURL('**/trabajadores', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const nominaLinks = page.locator('a[href="/nomina-trabajadores"]');
  const nominaCount = await nominaLinks.count();
  await clickVisibleCenter(page, nominaLinks.nth(nominaCount - 1), 'Consultar nomina de trabajadores');
  await page.waitForURL('**/nomina-trabajadores', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  await clickVisibleCenter(page, page.locator('input[type="button"][value="ALTA DE TRABAJADOR"]').first(), 'Alta de trabajador');
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  await dumpPage(page, 'alta_trabajador');
  console.log('No hago nada mas. Ventana abierta 2 horas.');
  await page.waitForTimeout(2 * 60 * 60 * 1000);
} catch (err) {
  const screenshot = `${outDir}/alta_trabajador_error.png`;
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  console.error(`${err?.message || err}. Captura: ${screenshot}`);
  console.error('No hago nada mas. Ventana abierta 2 horas para revisar.');
  await page.waitForTimeout(2 * 60 * 60 * 1000);
}
