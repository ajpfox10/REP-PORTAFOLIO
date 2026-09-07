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

async function mockSurgeryFlow(page) {
  const patient = { id: 101, name: 'Toby', species: 'Perro', primary_owner: 'Ana Perez' }
  const surgeryTypes = [
    { id: 1, name: 'Castracion', category_name: 'General', risk_level: 'medium', estimated_duration_minutes: 45 },
    { id: 2, name: 'Profilaxis dental', category_name: 'Dental', risk_level: 'low', estimated_duration_minutes: 60 },
  ]
  const surgeries = [
    {
      id: 1,
      patient_name: 'Luna',
      species: 'Gato',
      surgery_type_name: 'Esterilizacion',
      category_name: 'General',
      surgeon_name: 'Dra. Gomez',
      status: 'scheduled',
      scheduled_date: '2026-05-02T09:00:00Z',
      duration_minutes: 45,
      anesthesia_records: [],
    },
  ]
  let createdSurgery = null

  await page.route('**/api/v1/surgeries**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/surgeries') {
      const data = createdSurgery ? [createdSurgery, ...surgeries] : surgeries
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/surgeries/types/all') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: surgeryTypes }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/surgeries/1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: surgeries[0] }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/surgeries/2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: createdSurgery }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/surgeries') {
      createdSurgery = {
        id: 2,
        patient_name: 'Toby',
        species: 'Perro',
        surgery_type_name: 'Castracion',
        category_name: 'General',
        surgeon_name: 'Dra. Gomez',
        status: 'scheduled',
        scheduled_date: '2026-05-03T09:00:00Z',
        duration_minutes: 90,
        notes: 'Post operatorio',
        anesthesia_records: [],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/surgeries/2/status') {
      const body = await route.request().postDataJSON()
      createdSurgery = { ...createdSurgery, status: body.status }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: createdSurgery }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/surgeries/2/anesthesia') {
      createdSurgery = {
        ...createdSurgery,
        anesthesia_records: [
          {
            anesthesia_type: 'general',
            anesthetic_agents: 'Propofol, isoflurano',
            total_duration_minutes: 65,
            complications: false,
          },
        ],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
        body: JSON.stringify({ success: true, data: [patient] }),
      })
      return
    }

    await route.fallback()
  })
}

async function mockLaboratoryFlow(page) {
  const patient = { id: 201, name: 'Milo', species: 'Perro', primary_owner: 'Juan Gomez' }
  const tests = [
    { id: 1, name: 'Hemograma', category_name: 'Hematologia', units: '', normal_range: '4.0-10.0', turnaround_hours: 4 },
    { id: 2, name: 'Glucosa', category_name: 'Bioquimica', units: 'mg/dL', normal_range: '70-110', turnaround_hours: 2 },
  ]
  const orders = [
    {
      id: 1,
      patient_name: 'Luna',
      species: 'Gato',
      vet_name: 'Dra. Gomez',
      test_count: 1,
      priority: 'routine',
      status: 'pending',
      requested_at: '2026-05-01T10:00:00Z',
    },
  ]
  let createdOrder = null
  const resultItems = [
    { id: 11, test_name: 'Hemograma', name: 'Hemograma', normal_range: '4.0-10.0', units: '10^3/uL' },
    { id: 12, test_name: 'Glucosa', name: 'Glucosa', normal_range: '70-110', units: 'mg/dL' },
  ]

  await page.route('**/api/v1/lab/orders**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/lab/orders') {
      const data = createdOrder ? [createdOrder, ...orders] : orders
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/lab/orders/pending') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/lab/orders/2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 2,
            patient_name: 'Milo',
            species: 'Perro',
            status: createdOrder?.status || 'pending',
            items: resultItems,
          },
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/lab/orders/1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 1,
            patient_name: 'Luna',
            species: 'Gato',
            status: 'pending',
            items: resultItems.slice(0, 1),
          },
        }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/lab/orders') {
      createdOrder = {
        id: 2,
        patient_name: 'Milo',
        species: 'Perro',
        vet_name: 'Dra. Gomez',
        test_count: 2,
        priority: 'urgent',
        status: 'pending',
        requested_at: '2026-05-01T11:00:00Z',
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/lab/orders/2/results') {
      createdOrder = { ...createdOrder, status: 'completed' }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
        body: JSON.stringify({ success: true, data: [patient] }),
      })
      return
    }

    await route.fallback()
  })

  await page.route('**/api/v1/lab/tests**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/lab/tests') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: tests,
        }),
      })
      return
    }

    await route.fallback()
  })
}

async function mockImagingFlow(page) {
  const patient = { id: 301, name: 'Kira', species: 'Perro', primary_owner: 'Lucia Vega' }
  const types = [
    { id: 1, name: 'Radiografia torax', modality: 'xray', preparation_required: true, preparation_instructions: 'Ayuno 8h' },
    { id: 2, name: 'Ecografia abdominal', modality: 'ultrasound', preparation_required: false },
  ]
  const orders = [
    {
      id: 1,
      patient_name: 'Luna',
      species: 'Gato',
      vet_name: 'Dra. Gomez',
      modality: 'xray',
      status: 'pending',
      requested_at: '2026-05-01T09:00:00Z',
      has_report: false,
      study_count: 1,
    },
  ]
  let createdOrder = null

  await page.route('**/api/v1/imaging/orders**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/imaging/orders') {
      const data = createdOrder ? [createdOrder, ...orders] : orders
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/imaging/orders/2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 2,
            patient_name: 'Kira',
            modality: 'ultrasound',
            status: createdOrder?.status || 'pending',
            report: createdOrder?.report || null,
          },
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/imaging/orders/1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 1,
            patient_name: 'Luna',
            modality: 'xray',
            status: 'pending',
            report: null,
          },
        }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/imaging/orders') {
      createdOrder = {
        id: 2,
        patient_name: 'Kira',
        species: 'Perro',
        vet_name: 'Dra. Gomez',
        modality: 'ultrasound',
        status: 'pending',
        requested_at: '2026-05-01T11:30:00Z',
        has_report: false,
        study_count: 1,
        report: null,
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/imaging/orders/2/report') {
      createdOrder = {
        ...createdOrder,
        has_report: true,
        status: 'reported',
        report: {
          findings: 'Sin hallazgos agudos',
          conclusion: 'Informe normal',
          recommendations: 'Control clínico',
          radiologist_name: 'Dr. Radiologo',
        },
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
        body: JSON.stringify({ success: true, data: [patient] }),
      })
      return
    }

    await route.fallback()
  })

  await page.route('**/api/v1/imaging/types**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/imaging/types') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: types }),
      })
      return
    }

    await route.fallback()
  })
}

test('cirugias can create, change status and register anesthesia', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockSurgeryFlow(page)

  await page.goto('/cirugias')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /\+ Programar/i }).click()
  const modal = page.locator('div.modal').first()
  const form = modal.locator('form')

  await form.locator('input[type="search"]').fill('Toby')
  await page.getByRole('option', { name: /Seleccionar Toby/i }).click()
  await form.locator('select').first().selectOption('1')
  await form.locator('input[type="datetime-local"]').fill('2026-05-03T09:00')
  await form.locator('input[type="number"]').fill('90')
  await form.locator('textarea').fill('Post operatorio')
  await form.locator('button[type="submit"]').click()

  await expect(form.locator('.selected-patient')).toContainText('Toby')

  const surgeryRow = page.getByRole('row', { name: /Toby/ })
  await surgeryRow.getByRole('button').first().click()
  await page.locator('.status-options button').first().click()
  await expect(surgeryRow.getByText('En curso')).toBeVisible()

  await surgeryRow.getByRole('button', { name: /Anestesia/i }).click()
  const anesthesiaForm = page.locator('div.modal').last().locator('form')
  await anesthesiaForm.locator('select').first().selectOption('general')
  await anesthesiaForm.locator('textarea').first().fill('Propofol, isoflurano')
  await anesthesiaForm.locator('textarea').nth(1).fill('Monitoreo estable')
  await anesthesiaForm.locator('button[type="submit"]').click()

  await surgeryRow.getByRole('button', { name: /Ver detalle/i }).click()
  await expect(page.getByRole('heading', { name: /Toby/i })).toBeVisible()
})

test('laboratorio can create an order and submit results', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockLaboratoryFlow(page)

  await page.goto('/laboratorio')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /\+ Nueva/i }).click()
  const modal = page.locator('div.modal').first()
  const form = modal.locator('form')

  await form.locator('input[type="search"]').fill('Milo')
  await page.getByRole('option', { name: /Seleccionar Milo/i }).click()
  await form.locator('label.test-checkbox-label').first().click()
  await form.locator('label.test-checkbox-label').nth(1).click()
  await form.locator('textarea').fill('Seguimiento rutinario')
  await form.locator('button[type="submit"]').click()

  await expect(form.locator('.selected-patient')).toContainText('Milo')

  const labRow = page.getByRole('row', { name: /Milo/ })
  await labRow.getByRole('button', { name: /Resultados/i }).click()
  const resultsModal = page.locator('div.modal').last()
  const resultsForm = resultsModal.locator('form')
  await resultsForm.locator('input[type="text"]').first().fill('5.6')
  await resultsForm.locator('select').first().selectOption('normal')
  await resultsForm.locator('button[type="submit"]').click()

  await expect(labRow.getByText('Completada')).toBeVisible()
})

test('imagenes can create a study and publish a report', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockImagingFlow(page)

  await page.goto('/imagenes')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /\+ Nueva/i }).click()
  const modal = page.locator('div.modal').first()
  const form = modal.locator('form')

  await form.locator('input[type="search"]').fill('Kira')
  await page.getByRole('option', { name: /Seleccionar paciente Kira/i }).click()
  await form.locator('select').first().selectOption('2')
  await form.locator('textarea').fill('Control abdominal')
  await form.locator('button[type="submit"]').click()

  await expect(form.locator('.selected-patient')).toContainText('Kira')

  const imagingRow = page.getByRole('row', { name: /Kira/ })
  await imagingRow.getByRole('button', { name: /Informe/i }).click()
  const reportModal = page.locator('div.modal').last()
  const reportForm = reportModal.locator('form')
  await reportForm.locator('textarea').first().fill('Sin hallazgos agudos')
  await reportForm.locator('textarea').nth(1).fill('Informe normal')
  await reportForm.locator('textarea').nth(2).fill('Control clínico')
  await reportForm.locator('input[type="text"]').fill('Dr. Radiologo')
  await reportForm.locator('button[type="submit"]').click()

  await expect(imagingRow.getByRole('button', { name: /Ver informe/i })).toBeVisible()
})
