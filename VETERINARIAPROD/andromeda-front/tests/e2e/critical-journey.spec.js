import { test, expect } from '@playwright/test'

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

async function mockAuthenticatedSession(page, role = 'org_admin') {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'es-AR' })
  })

  const token = makeJwt({
    sub: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: [role],
    permissions: ['*'],
    org_id: 'org-1',
  })

  const user = {
    id: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: [role],
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

  await page.route('**/api/v1/appointments**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'GET' && url.pathname === '/api/v1/appointments') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 1,
              scheduled_date: '2026-05-10T10:30:00Z',
              patient_name: 'Luna',
              owner_name: 'Ana Perez',
              reason: 'Control',
              status: 'scheduled',
            },
          ],
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }
    if (method === 'GET' && url.pathname === '/api/v1/appointments/types') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: 1, name: 'Consulta general' }] }),
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/v1/appointments') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/v1/auth/admin/users**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/auth/admin/users') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ id: 9, first_name: 'Dra.', last_name: 'Gomez', roles: ['veterinarian'], is_active: true }],
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/v1/patients**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/patients') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ id: 10, name: 'Luna', primary_owner: 'Ana Perez', species: 'Perro' }],
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/v1/invoices**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'GET' && url.pathname === '/api/v1/invoices') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 1001,
              invoice_number: 'F-1001',
              client_name: 'Ana Perez',
              patient_name: 'Luna',
              issued_date: '2026-05-01',
              due_date: '2026-05-10',
              total_amount: 15000,
              status: 'pending',
            },
          ],
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }
    if (method === 'GET' && url.pathname === '/api/v1/invoices/1001') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 1001,
            invoice_number: 'F-1001',
            client_name: 'Ana Perez',
            patient_name: 'Luna',
            issued_date: '2026-05-01',
            due_date: '2026-05-10',
            total_amount: 15000,
            status: 'pending',
            items: [{ description: 'Consulta clínica', quantity: 1, unit_price: 15000, total: 15000 }],
          },
        }),
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/v1/invoices') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 1002 } }),
      })
      return
    }
    if (method === 'PATCH' && url.pathname === '/api/v1/invoices/1001/pay') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'paid' }),
      })
      return
    }
    await route.fallback()
  })
}

test('critical journey: login, schedule appointment and mark invoice paid', async ({ page }) => {
  await mockAuthenticatedSession(page)

  await page.goto('/')
  await expect(page.locator('.sidebar')).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: /Turnos/i }).click()
  await expect(page).toHaveURL(/\/turnos$/)
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /Nuevo turno|Nueva cita|Turno nuevo/i }).click()
  const appointmentModal = page.locator('.modal').last()
  await appointmentModal.locator('input[type="datetime-local"]').fill('2026-05-10T13:30')
  await appointmentModal.locator('select').nth(0).selectOption('1')
  await appointmentModal.locator('select').nth(1).selectOption('9')
  await appointmentModal.locator('input[type="search"]').fill('Lu')
  await appointmentModal.getByRole('option', { name: /Luna/i }).click()
  await appointmentModal.getByRole('button', { name: /Guardar|Crear|Agendar/i }).click()

  await page.locator('.sidebar').getByRole('link', { name: /Factur/i }).click()
  await expect(page).toHaveURL(/\/facturacion$/)
  await expect(page.getByText('F-1001')).toBeVisible()

  await page.getByRole('button', { name: /Marcar pago|Pago/i }).first().click()
  const paymentModal = page.locator('.modal').last()
  await paymentModal.locator('select').selectOption('cash')
  await paymentModal.getByRole('button', { name: /Confirmar pago|Registrar pago/i }).click()
  await expect(page.locator('.badge.inv-paid')).toBeVisible()
})
