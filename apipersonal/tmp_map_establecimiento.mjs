import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';

dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const outDir = 'C:/apps/personaldev/apipersonal/logs/art';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error('Falta ' + name);
  return value;
}

async function clickCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error('Sin bbox ' + label);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
  await page.goto(process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados', { waitUntil: 'domcontentloaded' });

  const inputs = page.locator('input:not([type="hidden"]):not([readonly])');
  await inputs.nth(0).click();
  await inputs.nth(0).press('Control+A');
  await inputs.nth(0).type(env('ART_PROVINCIA_USER'), { delay: 35 });
  await inputs.nth(1).click();
  await inputs.nth(1).press('Control+A');
  await inputs.nth(1).type(env('ART_PROVINCIA_PASSWORD'), { delay: 35 });

  await clickCenter(page, page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first(), 'login');
  await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  await page.locator('#menu_21').click();
  await page.waitForTimeout(800);
  await page.locator('#linkSubmenu_422').click();
  await page.waitForURL('**/trabajadores', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);

  const nomina = page.locator('a[href="/nomina-trabajadores"]');
  await clickCenter(page, nomina.nth((await nomina.count()) - 1), 'nomina');
  await page.waitForURL('**/nomina-trabajadores', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);

  await clickCenter(page, page.locator('input[type="button"][value="ALTA DE TRABAJADOR"]').first(), 'alta');
  await page.waitForURL('**/nomina-trabajadores/alta-trabajador', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  await page.locator('#altaEstablecimientos').scrollIntoViewIfNeeded();
  await clickCenter(page, page.locator('#altaEstablecimientos'), 'alta establecimientos');
  await page.waitForTimeout(1000);
  await page.locator('xpath=//*[contains(normalize-space(.), "AGREGAR ESTABLECIMIENTO")]/following::input[not(@type="hidden")][1]').fill(process.env.ART_ESTABLECIMIENTO_BUSQUEDA || '32');
  await clickCenter(page, page.locator('xpath=//*[contains(normalize-space(.), "AGREGAR ESTABLECIMIENTO")]/following::input[@type="button" or @type="submit" or self::button][contains(@value, "BUSCAR") or contains(normalize-space(.), "BUSCAR")][1]').or(page.getByText('BUSCAR', { exact: false })).first(), 'buscar establecimiento');
  await page.waitForTimeout(1500);

  const screenshot = outDir + '/establecimiento_mapeo.png';
  await page.screenshot({ path: screenshot, fullPage: true });

  const data = await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('*')).map((el, index) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        index,
        tag: el.tagName,
        text: clean(el.innerText || el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt')).slice(0, 220),
        id: el.id || null,
        name: el.getAttribute('name'),
        type: el.getAttribute('type'),
        href: el.getAttribute('href'),
        onclick: el.getAttribute('onclick'),
        role: el.getAttribute('role'),
        title: el.getAttribute('title'),
        alt: el.getAttribute('alt'),
        src: el.getAttribute('src'),
        classes: typeof el.className === 'string' ? el.className : String(el.className || ''),
        visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    }).filter((x) => {
      const blob = `${x.text} ${x.id} ${x.name} ${x.classes} ${x.src} ${x.title} ${x.alt} ${x.onclick}`.toLowerCase();
      return x.visible && x.rect.y >= 90 && x.rect.y <= 650 && (/^(A|BUTTON|INPUT|SELECT|IMG|I|SPAN|SVG|USE|DIV)$/.test(x.tag) || x.onclick || /check|seleccion|establec|buscar|tilde|acept|agregar|ui-icon/.test(blob));
    });
  });

  await fs.writeFile(outDir + '/establecimiento_mapeo.json', JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, screenshot, json: outDir + '/establecimiento_mapeo.json', rows: data.length }, null, 2));
} finally {
  await browser.close().catch(() => undefined);
}
