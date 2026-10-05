// Probe READ-ONLY: busca en /nomina-trabajadores desde la pantalla (Catán) y anota el pedido
// real que hace el portal a index_busqueda.php, para comparar con el que arma art_bajar_nomina.
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });
const opt = (n, d = '') => process.env[n]?.trim() || d;
const must = (n) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`Falta ${n}`); return v; };
async function clickVC(page, loc) { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); }
async function typeInto(page, loc, v) { await loc.click({ timeout: 15000 }); await loc.press('Control+A'); await loc.press('Backspace'); await loc.type(String(v), { delay: 35 }); }
const OUT = path.join(appRoot, 'logs', 'art_capture');

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const pedidos = [];
ctx.on('request', (r) => { if (/busqueda|nomina/i.test(r.url()) && !/\.(css|js|png|gif)/.test(r.url())) pedidos.push(`${r.method()} ${r.url()} ${r.postData() || ''}`); });
try {
  await page.goto(opt('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados'), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const lb = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion")').first();
  if (await lb.isVisible({ timeout: 5000 }).catch(() => false)) {
    const li = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(page, li.nth(0), must('ART_PROVINCIA_USER'));
    await typeInto(page, li.nth(1), must('ART_PROVINCIA_PASSWORD'));
    await page.waitForTimeout(400); await clickVC(page, lb);
    await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.goto('https://www.provinciart.com.ar/nomina-trabajadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // el form puede estar en la pagina o en un iframe
  const frames = page.frames();
  let fr = null;
  for (const f of frames) if (await f.locator('#establecimiento').count().catch(() => 0)) { fr = f; break; }
  console.log('frames:', frames.map((f) => f.url()).join(' | '));
  if (!fr) { await fs.writeFile(path.join(OUT, 'probe_grilla_pagina.html'), await page.content()); throw new Error('no encuentro #establecimiento'); }
  const opciones = await fr.evaluate(() => Array.from(document.querySelectorAll('#establecimiento option')).map((o) => `${o.value}=${o.textContent.trim().slice(0, 40)}`));
  console.log('opciones:', opciones.length, opciones.slice(0, 6));
  const form = await fr.evaluate(() => { const f = document.querySelector('#formNominaTrabajadores') || document.querySelector('form'); return f ? f.outerHTML.slice(0, 4000) : 'SIN FORM'; });
  await fs.writeFile(path.join(OUT, 'probe_grilla_form.html'), form);
  await fr.selectOption('#establecimiento', '488242');
  await page.waitForTimeout(800);
  const btn = fr.locator('#formNominaTrabajadores button, #formNominaTrabajadores input[type=button], #formNominaTrabajadores input[type=submit], button:has-text("Buscar"), input[value*="uscar" i]').first();
  console.log('boton:', await btn.count() ? await btn.evaluate((b) => b.outerHTML.slice(0, 200)) : 'no hay');
  if (await btn.count()) await btn.click({ timeout: 10000 }).catch((e) => console.log('click fallo', e.message));
  await page.waitForTimeout(8000);
  const filas = await fr.evaluate(() => document.querySelectorAll('#divContentGrid tr').length).catch(() => -1);
  console.log('filas en grilla tras buscar:', filas);
  await fs.writeFile(path.join(OUT, 'probe_grilla_resultado.html'), await fr.content());
} catch (e) { console.log('ERROR', e.message); }
finally { console.log('PEDIDOS:\n' + pedidos.join('\n')); await browser.close(); }
