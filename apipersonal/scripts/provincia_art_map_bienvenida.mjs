import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';

dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const loginUrl = process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados';
const outDir = 'C:/apps/personaldev/apipersonal/logs/art';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

const browser = await chromium.launch({
  channel: process.env.ART_BROWSER_CHANNEL || 'chrome',
  headless: false,
  slowMo: 250,
  args: ['--start-maximized'],
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

try {
  await fs.mkdir(outDir, { recursive: true });
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  const visibleInputs = page.locator('input:not([type="hidden"]):not([readonly])');
  await visibleInputs.nth(0).fill(requiredEnv('ART_PROVINCIA_USER'));
  await visibleInputs.nth(1).fill(requiredEnv('ART_PROVINCIA_PASSWORD'));
  await page.getByRole('button', { name: /Iniciar sesi/i }).click();
  await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(3000);

  const screenshot = `${outDir}/bienvenida_cliente.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  const data = await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const clickable = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], .card, .mat-card, li, [class*="menu"], [class*="contract"], [class*="contrato"]'))
      .map((el, index) => ({
        index,
        tag: el.tagName,
        text: clean(el.innerText || el.textContent || el.getAttribute('aria-label')),
        href: el.getAttribute('href'),
        role: el.getAttribute('role'),
        classes: el.getAttribute('class'),
        id: el.getAttribute('id'),
      }))
      .filter((x) => x.text || x.href || x.id || x.classes);

    return {
      url: location.href,
      title: document.title,
      bodyText: clean(document.body.innerText).slice(0, 5000),
      clickable,
    };
  });

  await fs.writeFile(`${outDir}/bienvenida_cliente_map.json`, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, screenshot, map: `${outDir}/bienvenida_cliente_map.json`, url: data.url, title: data.title }, null, 2));
  console.log('Ventana abierta 30 minutos en bienvenida para mirar juntos.');
  await page.waitForTimeout(30 * 60 * 1000);
} catch (err) {
  const screenshot = `${outDir}/bienvenida_cliente_error.png`;
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  console.error(`${err?.message || err}. Captura: ${screenshot}`);
  await page.waitForTimeout(30 * 60 * 1000);
}
