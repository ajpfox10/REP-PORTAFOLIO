import { test, expect } from '@playwright/test'

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

async function mockAuthenticatedSession(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'es-AR' })
  })

  const token = makeJwt({
    sub: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: ['accountant'],
    permissions: ['*'],
    org_id: 'org-1',
  })

  const user = {
    id: 'user-1',
    email: 'vet@example.com',
    name: 'Veterinaria Demo',
    roles: ['accountant'],
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
}

async function mockBillingData(page) {
  await page.route('**/api/v1/invoices**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/invoices') {
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

    if (method === 'GET' && path === '/api/v1/invoices/1001') {
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
            notes: 'Consulta + laboratorio',
            items: [
              { description: 'Consulta clínica', quantity: 1, unit_price: 10000, total: 10000 },
              { description: 'Hemograma', quantity: 1, unit_price: 5000, total: 5000 },
            ],
          },
        }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/invoices/1001/pay') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'paid' }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/invoices/1001/cancel') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'cancelled' }),
      })
      return
    }

    await route.fallback()
  })
}

test('billing list opens detail and marks invoice as paid', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockBillingData(page)

  await page.goto('/facturacion')

  await expect(page.getByText('F-1001')).toBeVisible()
  await expect(page.getByText('Ana Perez')).toBeVisible()

  await page.getByTitle('Ver detalle').click()
  await expect(page.getByRole('heading', { name: /Detalle de factura/i })).toBeVisible()
  await expect(page.getByText('Consulta + laboratorio')).toBeVisible()

  await page.getByRole('button', { name: /Cerrar/i }).click()
  await expect(page.getByText('Consulta + laboratorio')).toBeHidden()

  await page.getByRole('button', { name: /Marcar pago/i }).click()
  await expect(page.getByRole('heading', { name: /Registrar pago/i })).toBeVisible()

  await page.locator('.modal').last().getByRole('combobox').selectOption('cash')
  await page.getByRole('button', { name: /Confirmar pago/i }).click()

  await expect(page.locator('.table .badge.inv-paid')).toBeVisible()
})
