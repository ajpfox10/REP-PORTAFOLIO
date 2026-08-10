import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/apps/personaldev/apipersonal/.env' });

const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 250 });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(process.env.ART_LOGIN_URL || 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados', { waitUntil: 'domcontentloaded' });
await page.locator('input:not([type="hidden"]):not([readonly])').nth(0).fill(process.env.ART_PROVINCIA_USER || '');
await page.locator('input:not([type="hidden"]):not([readonly])').nth(1).fill(process.env.ART_PROVINCIA_PASSWORD || '');
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Iniciar sesi/i }).click();
await page.waitForTimeout(5000);
console.log('Chrome visible abierto. URL actual:', page.url());
console.log('Dejo esta sesion abierta 10 minutos para continuar la prueba.');
await page.waitForTimeout(10 * 60 * 1000);
