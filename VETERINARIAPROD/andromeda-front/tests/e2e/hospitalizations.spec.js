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

async function mockHospitalizations(page) {
  let admittedPatient = null

  await page.route('**/api/v1/hospitalizations**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/hospitalizations') {
      const list = [
        {
          id: 1,
          patient_name: 'Luna',
          species: 'Perro',
          ward_name: 'Sala A',
          kennel_number: 3,
          attending_vet_name: 'Dra. Gomez',
          admission_date: '2026-05-01T10:00:00Z',
          days_hospitalized: 2,
          status: 'admitted',
          admission_reason: 'Post operatorio',
        },
      ]

      if (admittedPatient) {
        list.unshift(admittedPatient)
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: list,
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/hospitalizations/board') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 10,
              ward_name: 'Sala A',
              ward_type: 'Internación',
              total_kennels: 5,
              available_kennels: 2,
              kennels: [
                { id: 100, number: 1, status: 'occupied', kennel_type: 'M' },
                { id: 101, number: 2, status: 'free', kennel_type: 'M' },
              ],
            },
          ],
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/hospitalizations/wards/availability') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 10,
              name: 'Sala A',
              available_kennels: 2,
              kennels: [
                { id: 201, number: 1, status: 'available', kennel_type: 'M' },
                { id: 202, number: 2, status: 'free', kennel_type: 'M' },
              ],
            },
          ],
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/hospitalizations/1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 1,
            patient_name: 'Luna',
            ward_name: 'Sala A',
            kennel_number: 3,
            attending_vet_name: 'Dra. Gomez',
            admission_date: '2026-05-01T10:00:00Z',
            days_hospitalized: 2,
            admission_reason: 'Post operatorio',
            status: 'admitted',
            monitoring: [],
            medications: [],
          },
        }),
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/hospitalizations/2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 2,
            patient_name: 'Milo',
            ward_name: 'Sala A',
            kennel_number: 1,
            attending_vet_name: 'Dra. Gomez',
            admission_date: '2026-05-01T12:00:00Z',
            days_hospitalized: 0,
            admission_reason: 'Observacion',
            status: 'admitted',
            monitoring: [],
            medications: [],
          },
        }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/hospitalizations') {
      admittedPatient = {
        id: 2,
        patient_name: 'Milo',
        species: 'Gato',
        ward_name: 'Sala A',
        kennel_number: 1,
        attending_vet_name: 'Dra. Gomez',
        admission_date: '2026-05-01T12:00:00Z',
        days_hospitalized: 0,
        status: 'admitted',
        admission_reason: 'Observacion',
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/hospitalizations/1/discharge') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'discharged' }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/hospitalizations/2/discharge') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'discharged' }),
      })
      return
    }

    if (method === 'POST' && path.includes('/monitoring')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
      return
    }

    if (method === 'POST' && path.includes('/medications')) {
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
    const path = url.pathname

    if (path === '/api/v1/patients') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { id: 77, name: 'Luna', species: 'Perro', primary_owner: 'Ana Perez' },
          ],
        }),
      })
      return
    }

    await route.fallback()
  })
}

test('hospitalizations can admit a patient and open discharge flow', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockHospitalizations(page)

  await page.goto('/hospitalizaciones')

  await expect(page.getByText('Luna')).toBeVisible()
  await expect(page.getByText('Sala A')).toBeVisible()

  await page.getByRole('button', { name: /Admitir paciente/i }).click()
  await expect(page.getByRole('heading', { name: /Admitir paciente/i })).toBeVisible()

  const admitModal = page.locator('div.modal').first()
  const admitForm = admitModal.locator('form')

  await admitForm.locator('input[type="search"]').fill('Luna')
  await page.getByRole('option', { name: /Seleccionar Luna/i }).click()
  await admitForm.locator('select').first().selectOption('10')
  await admitForm.locator('input[type="text"]').first().fill('42')
  await admitForm.locator('textarea').fill('Post operatorio')
  await admitForm.locator('button[type="submit"]').click()

  await expect(page.getByText('Milo')).toBeVisible()
  await page.getByRole('row', { name: /Milo/ }).getByRole('button', { name: /^Ver$/i }).click()
  await expect(page.getByRole('heading', { name: /Milo/i })).toBeVisible()

  await page.locator('div.modal').last().getByRole('button', { name: /Dar alta/i }).click()
  await expect(page.getByRole('heading', { name: /Dar alta/i })).toBeVisible()
})
