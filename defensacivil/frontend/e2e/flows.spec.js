import { test, expect } from '@playwright/test';

const PASSWORD = 'Admin2503!';

async function login(page, username) {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
}

test('la sesión sobrevive a una recarga y se cierra al salir', async ({ page }) => {
  await login(page, 'admin');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();

  // Los tokens no quedan en el almacenamiento del navegador
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/eyJ/);

  await page.getByRole('button', { name: /Administrador del Sistema/ }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('credenciales incorrectas muestran un error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('Incorrecta1');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toContainText('Credenciales inválidas');
});

test('la central registra una llamada y el móvil informa desde el lugar', async ({ page }) => {
  await login(page, 'telefonista1');
  await page.getByRole('link', { name: 'Central telefónica' }).click();

  await page.locator('.map-card .leaflet-container').click({ position: { x: 300, y: 260 } });
  await expect(page.getByText('Lugar marcado')).toBeVisible();
  await page.getByLabel('Tipo de incidente').selectOption({ label: 'Incendio' });
  await page.getByLabel('Qué informa quien llama').fill('Humo negro saliendo de un galpón, vecinos en la vereda.');
  await page.getByLabel('Dirección o referencia').fill('Av. Prueba E2E 1234');
  await page.getByRole('button', { name: 'Registrar incidente' }).click();

  const success = page.locator('.alert-success');
  await expect(success).toContainText(/DC-\d{4}-\d{6} registrado/);
  const number = (await success.locator('strong').textContent()).trim();

  // El chofer lo toma, cambia el estado y deja una novedad
  await page.getByRole('button', { name: /Telefonista Pérez Laura/ }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await login(page, 'chofer1');
  await page.getByRole('link', { name: 'Móvil en calle' }).click();
  await page.getByRole('button', { name: new RegExp(`Incendio en Av. Prueba E2E 1234`) }).click();
  await page.getByRole('button', { name: 'En escena', exact: true }).click();
  await page.getByLabel('Novedad').fill('Llegamos, fuego en el sector trasero.');
  await page.getByRole('button', { name: 'Enviar novedad' }).click();
  await expect(page.getByText(`${number} actualizado`)).toBeVisible();

  // El historial muestra la novedad
  await page.getByRole('link', { name: 'Detalle' }).click();
  await expect(page.getByRole('heading', { name: 'Incendio en Av. Prueba E2E 1234' })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('Llegamos, fuego en el sector trasero.');
});

test('editar un incidente conserva provincia y partido', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/incidents?search=Quilmes%20Oeste');
  await page.getByRole('link', { name: 'Anegamiento de calles en Quilmes Oeste' }).first().click();
  await page.getByRole('link', { name: 'Editar' }).click();

  await expect(page.getByLabel('Partido / departamento')).toHaveValue(/\d+/);
  await page.getByLabel('Responsable a cargo').fill('Jefa de turno Ramírez');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Jefa de turno Ramírez')).toBeVisible();
  await expect(page.locator('.kv')).toContainText('Quilmes, Buenos Aires');
});

test('cambiar el estado desde el detalle queda en el historial', async ({ page }) => {
  await login(page, 'operador1');
  await page.goto('/incidents?status=CONTROLADO');
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Cambiar estado' }).click();
  await page.getByLabel('Nuevo estado').selectOption('CERRADO');
  await page.getByLabel('Nota').fill('Se normalizó la situación.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.page-header .badge').first()).toHaveText('Cerrado');
  await expect(page.locator('.timeline')).toContainText('Se normalizó la situación.');
});

test('un lector no ve las acciones de escritura ni las pantallas de administración', async ({ page }) => {
  await login(page, 'lector1');
  await expect(page.getByRole('link', { name: 'Nuevo incidente' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.goto('/usuarios');
  await expect(page).toHaveURL(/\/dashboard/);
});

test('el administrador da de alta un usuario con rol de chofer', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await page.getByRole('link', { name: 'Nuevo usuario' }).click();
  await page.getByLabel('Nombre completo').fill('Chofer de Prueba');
  await page.locator('#u-username').fill('choferprueba');
  await page.getByLabel('Email').fill('choferprueba@test.gob.ar');
  await page.getByLabel('Contraseña inicial').fill('Choferes2026');
  await page.getByLabel(/^Chofer/).check();
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  await expect(page.getByRole('cell', { name: /Chofer de Prueba/ })).toBeVisible();
});
