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
    roles: ['veterinarian'],
    permissions: ['*'],
    org_id: 'org-1',
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
}

async function mockPatients(page, items) {
  await page.route('**/api/v1/patients**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/patients') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: items }),
      })
      return
    }
    await route.fallback()
  })
}

async function mockVaccinations(page) {
  const vaccines = [
    { id: 1, name: 'Quintuple', manufacturer: 'VetLab' },
    { id: 2, name: 'Rabia', manufacturer: 'VetLab' },
  ]
  const dewProducts = [
    { id: 11, name: 'Pipeta Duo', parasite_type: 'Pulgas' },
    { id: 12, name: 'Tableta Total', parasite_type: 'Gastrointestinales' },
  ]
  let vaccineRecords = [
    {
      id: 1,
      species: 'Perro',
      patient_name: 'Luna',
      vaccine_name: 'Quintuple',
      administered_by: 'Dra. Gomez',
      manufacturer: 'VetLab',
      vaccination_date: '2026-04-30T10:00:00Z',
      next_dose_due: '2026-05-30T10:00:00Z',
      lot_number: 'LOT-001',
      status: 'up_to_date',
    },
  ]
  let dewRecords = [
    {
      id: 1,
      species: 'Gato',
      patient_name: 'Milo',
      product_name: 'Pipeta Duo',
      active_ingredient: 'Selamectina',
      parasite_type: 'Pulgas',
      deworming_date: '2026-04-25T10:00:00Z',
      next_due_date: '2026-05-25T10:00:00Z',
      weight_at_treatment: 4.5,
      dose_administered: '1 pipeta',
      administered_by: 'Dra. Gomez',
    },
  ]
  let createdVaccine = null
  let createdDew = null

  await page.route('**/api/v1/vaccinations**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/vaccinations/vaccines') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: vaccines }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/vaccinations') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: vaccineRecords }) })
      return
    }

    if (method === 'POST' && path === '/api/v1/vaccinations') {
      createdVaccine = {
        id: 2,
        species: 'Perro',
        patient_name: 'Toby',
        vaccine_name: 'Rabia',
        administered_by: 'Dra. Gomez',
        manufacturer: 'VetLab',
        vaccination_date: '2026-05-01T12:00:00Z',
        next_dose_due: '2026-06-01T12:00:00Z',
        lot_number: 'LOT-999',
        status: 'up_to_date',
      }
      vaccineRecords = [createdVaccine, ...vaccineRecords]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 2 } }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/vaccinations/deworming/products') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: dewProducts }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/vaccinations/deworming') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: dewRecords }) })
      return
    }

    if (method === 'POST' && path === '/api/v1/vaccinations/deworming') {
      createdDew = {
        id: 2,
        species: 'Perro',
        patient_name: 'Toby',
        product_name: 'Tableta Total',
        active_ingredient: 'Praziquantel',
        parasite_type: 'Internos',
        deworming_date: '2026-05-01T13:00:00Z',
        next_due_date: '2026-06-01T13:00:00Z',
        weight_at_treatment: 8.2,
        dose_administered: '2 ml',
        administered_by: 'Dra. Gomez',
      }
      dewRecords = [createdDew, ...dewRecords]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 2 } }) })
      return
    }

    await route.fallback()
  })

  await mockPatients(page, [
    { id: 77, name: 'Toby', species: 'Perro', primary_owner: 'Ana Perez' },
    { id: 78, name: 'Milo', species: 'Gato', primary_owner: 'Juan Gomez' },
  ])
}

async function mockGrooming(page) {
  const groomers = [
    { id: 1, name: 'Lucia Perez' },
    { id: 2, name: 'Marta Diaz' },
  ]
  const services = [
    { id: 1, name: 'Baño' },
    { id: 2, name: 'Corte' },
  ]
  let appts = [
    {
      id: 1,
      patient_name: 'Luna',
      client_name: 'Ana Perez',
      groomer_name: 'Lucia Perez',
      services: ['Baño'],
      status: 'scheduled',
      scheduled_date: '2026-05-01T11:00:00Z',
      price: 2500,
    },
  ]

  await page.route('**/api/v1/grooming/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/grooming/service-types') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: services }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/grooming/groomers') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: groomers }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/grooming/appointments') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: appts }) })
      return
    }

    if (method === 'POST' && path === '/api/v1/grooming/appointments') {
      const body = await route.request().postDataJSON()
      appts = [
        {
          id: 2,
          patient_name: 'Toby',
          client_name: 'Ana Perez',
          groomer_name: 'Lucia Perez',
          services: ['Baño', 'Corte'],
          status: 'scheduled',
          scheduled_date: body.scheduledAt,
          price: body.estimatedPrice || 2500,
        },
        ...appts,
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 2 } }) })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/grooming/appointments/2/status') {
      const body = await route.request().postDataJSON()
      appts = appts.map((a) => (a.id === 2 ? { ...a, status: body.status } : a))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/grooming/appointments/1/status') {
      const body = await route.request().postDataJSON()
      appts = appts.map((a) => (a.id === 1 ? { ...a, status: body.status } : a))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    await route.fallback()
  })

  await mockPatients(page, [{ id: 77, name: 'Toby', species: 'Perro', primary_owner: 'Ana Perez' }])
}

async function mockTelemedicine(page) {
  const platforms = [
    { id: 1, name: 'Google Meet' },
    { id: 2, name: 'Zoom' },
  ]
  const vets = [
    { id: 1, first_name: 'Dra.', last_name: 'Gomez', roles: ['veterinarian'] },
  ]
  let sessions = [
    {
      id: 1,
      patient_name: 'Luna',
      vet_name: 'Dra. Gomez',
      platform_name: 'Google Meet',
      status: 'scheduled',
      scheduled_date: '2026-05-01T15:00:00Z',
      meeting_url: 'https://meet.example/luna',
      reason: 'Control general',
    },
  ]

  await page.route('**/api/v1/tele/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/tele/sessions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: sessions }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/tele/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ total_sessions: 1, completed_sessions: 0, avg_duration_minutes: 30, today_sessions: 1 }] }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/tele/platforms') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: platforms }) })
      return
    }

    if (method === 'POST' && path === '/api/v1/tele/sessions') {
      const body = await route.request().postDataJSON()
      sessions = [
        {
          id: 2,
          patient_name: 'Toby',
          vet_name: 'Dra. Gomez',
          platform_name: 'Zoom',
          status: 'scheduled',
          scheduled_date: body.scheduledAt,
          meeting_url: 'https://zoom.example/toby',
          reason: body.chiefComplaint,
        },
        ...sessions,
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 2 } }) })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/tele/sessions/2/status') {
      const body = await route.request().postDataJSON()
      sessions = sessions.map((s) => (s.id === 2 ? { ...s, status: body.status } : s))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    await route.fallback()
  })

  await mockPatients(page, [{ id: 77, name: 'Toby', species: 'Perro', primary_owner: 'Ana Perez' }])

  await page.route('**/api/v1/admin/users**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: vets }) })
  })
}

test('vacunas can register vaccine and deworming records', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockVaccinations(page)

  await page.goto('/vacunas')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /Registrar vacuna/i }).click()
  const vaccineForm = page.locator('div.modal').first().locator('form')
  await vaccineForm.locator('input[type="search"]').fill('Toby')
  await page.getByRole('option', { name: /Seleccionar Toby/i }).click()
  await vaccineForm.locator('select').first().selectOption('1')
  await vaccineForm.locator('input[type="text"]').fill('LOT-123')
  await vaccineForm.locator('input[type="date"]').first().fill('2026-05-01')
  await vaccineForm.locator('button[type="submit"]').click()
  await expect(vaccineForm.locator('.selected-patient')).toContainText('Toby')

  await page.locator('.main-tab-btn').nth(1).click()
  await page.getByRole('button', { name: /Registrar desparasitaci/i }).click()
  const dewForm = page.locator('div.modal').first().locator('form')
  await dewForm.locator('input[type="search"]').fill('Toby')
  await page.getByRole('option', { name: /Seleccionar Toby/i }).click()
  await dewForm.locator('select').first().selectOption('11')
  await dewForm.locator('input[type="date"]').first().fill('2026-05-01')
  await dewForm.locator('button[type="submit"]').click()
  await expect(page.locator('div.modal')).toHaveCount(0)
})

test('grooming can schedule a session and advance status', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockGrooming(page)

  await page.goto('/grooming')
  await expect(page.getByText('Luna')).toBeVisible()

  const row = page.locator('.groom-card').filter({ hasText: 'Luna' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Iniciar/i }).click()
  await expect(row).toContainText('En proceso')
})

test('telemedicine can schedule a session and change status', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockTelemedicine(page)

  await page.goto('/telemedicina')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /Nueva teleconsulta/i }).click()
  const form = page.locator('div.modal').first().locator('form')
  await form.locator('input[type="datetime-local"]').fill('2026-05-01T15:30')
  await form.locator('input[type="search"]').fill('Toby')
  await page.getByRole('option', { name: /Seleccionar Toby/i }).click()
  await form.locator('select').first().selectOption('30')
  await form.locator('select').nth(1).selectOption({ label: 'Veterinaria Demo' })
  await form.locator('textarea').fill('Control general')
  await form.locator('button[type="submit"]').click()

  const row = page.locator('.tele-card').filter({ hasText: 'Toby' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Cancelar/i }).click()
  await expect(row).toContainText('Cancelada')
})
