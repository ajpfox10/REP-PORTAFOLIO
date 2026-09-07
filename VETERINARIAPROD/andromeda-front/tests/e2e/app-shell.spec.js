import { test, expect } from '@playwright/test'

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

async function mockAuthenticatedSession(page, overrides = {}) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'es-AR' })
  })

  const token = makeJwt({
    sub: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: ['veterinarian'],
    permissions: ['*'],
    org_id: 'org-1',
    ...overrides,
  })

  const user = {
    id: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: ['veterinarian'],
    permissions: ['*'],
    org_id: 'org-1',
  }

  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { accessToken: token, user } }),
    })
  })

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: user }),
    })
  })

  await page.route('**/api/v1/auth/logout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  })

  await page.route('**/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { csrfToken: 'csrf-test-token' } }),
    })
  })

  await page.route('**/api/v1/appointments*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 1,
            scheduled_date: new Date().toISOString(),
            patient_name: 'Luna',
            reason: 'Control',
            status: 'scheduled',
          },
        ],
      }),
    })
  })

  await page.route('**/api/v1/patients/species/all', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 1, common_name: 'Perro', slug: 'perro' }],
      }),
    })
  })

  await page.route('**/api/v1/patients*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/patients/species/all')) return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 10,
            name: 'Luna',
            primary_owner: 'Ana Perez',
            species: 'Perro',
            breed_name: 'Labrador',
            birthdate: '2020-03-01',
            weight_kg: 18.2,
            is_active: true,
          },
        ],
        meta: { page: 1, totalPages: 1 },
        total: 1,
      }),
    })
  })

  return { token, user }
}

test('authenticated shell shows sidebar and navigates to pacientes', async ({ page }) => {
  await mockAuthenticatedSession(page)

  await page.goto('/')

  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('.sidebar').getByRole('link', { name: /Inicio/i })).toBeVisible()
  await expect(page.locator('.sidebar').getByRole('link', { name: /Pacientes/i })).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: /Pacientes/i }).click()

  await expect(page).toHaveURL(/\/pacientes$/)
  await expect(page.locator('.page-content').getByRole('heading', { name: /Pacientes/i })).toBeVisible()
  await expect(page.getByText('Luna')).toBeVisible()
  await expect(page.getByText('Ana Perez')).toBeVisible()
})

test('authenticated dashboard loads today appointments and can logout', async ({ page }) => {
  await mockAuthenticatedSession(page)

  await page.goto('/')

  await expect(page.getByText('Turnos de hoy')).toBeVisible()
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByTitle(/Cerrar sesi/i).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-page')).toBeVisible()
})
