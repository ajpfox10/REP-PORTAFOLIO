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
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const el = Array.from(document.querySelectorAll('*')).find((node) => clean(node.textContent).includes('TELÉFONOS DEL TRABAJADOR'));
    if (el) el.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 1200);
  });
  await page.waitForTimeout(700);

  const screenshot = outDir + '/telefono_mapeo.png';
  await page.screenshot({ path: screenshot, fullPage: true });

  const data = await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const headers = Array.from(document.querySelectorAll('*')).filter((el) => clean(el.textContent).toUpperCase().includes('TELÉFONOS DEL TRABAJADOR'));
    const header = headers.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    const hrect = header ? header.getBoundingClientRect() : { top: 0 };
    const rows = Array.from(document.querySelectorAll('*')).map((el, index) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        index,
        tag: el.tagName,
        text: clean(el.innerText || el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt')).slice(0, 160),
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
      return x.visible
        && x.rect.y >= hrect.top - 80
        && x.rect.y <= hrect.top + 900
        && (/^(A|BUTTON|INPUT|SELECT|IMG|I|SPAN|SVG|USE)$/.test(x.tag) || x.onclick || /edit|editar|lapiz|pencil|guardar|save|telefono|phone|icon/.test(blob));
    });
    return {
      url: location.href,
      title: document.title,
      headerRect: hrect ? { x: hrect.x, y: hrect.y, w: hrect.width, h: hrect.height } : null,
      rows,
    };
  });

  const frame = page.frame({ name: 'iframeTelefonos' });
  if (frame) {
    await frame.locator('#btnEditarTelefono_1').click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }
  const iframeData = frame ? await frame.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('*')).map((el, index) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        index,
        tag: el.tagName,
        text: clean(el.innerText || el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt')).slice(0, 180),
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
      return x.visible && (/^(A|BUTTON|INPUT|SELECT|IMG|I|SPAN|SVG|USE)$/.test(x.tag) || x.onclick || /edit|editar|lapiz|pencil|guardar|save|telefono|phone|icon|principal|número|numero/.test(blob));
    });
  }) : [];

  data.iframeTelefonos = iframeData;

  await fs.writeFile(outDir + '/telefono_mapeo.json', JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, screenshot, json: outDir + '/telefono_mapeo.json', rows: data.rows.length, iframeRows: iframeData.length }, null, 2));
} finally {
  await browser.close().catch(() => undefined);
}
