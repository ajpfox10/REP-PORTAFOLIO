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
    email: 'admin@example.com',
    name: 'Admin Demo',
    roles: ['org_admin'],
    permissions: ['*'],
    org_id: 'org-1',
  })

  const user = {
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin Demo',
    roles: ['org_admin'],
    permissions: ['*'],
    org_id: 'org-1',
    branchId: 1,
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

async function mockAdmin(page) {
  let users = [
    {
      id: 1,
      first_name: 'Ana',
      last_name: 'Gomez',
      email: 'ana@example.com',
      roles: ['veterinarian'],
      branch_name: 'Central',
      is_active: true,
      created_at: '2026-05-01T09:00:00Z',
    },
  ]
  let authPolicy = { two_factor_optional_enabled: false }
  let overrides = [
    { role: 'veterinarian', grant: ['patients.read'], revoke: [], updated: '2026-05-01T09:00:00Z' },
  ]

  await page.route('**/api/v1/auth/admin/users**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/auth/admin/users') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: users,
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/auth/admin/users') {
      const body = await route.request().postDataJSON()
      users = [
        {
          id: 2,
          first_name: body.firstName,
          last_name: body.lastName,
          email: body.email,
          roles: [body.role],
          branch_name: 'Central',
          is_active: true,
          created_at: '2026-05-01T10:00:00Z',
        },
        ...users,
      ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 2 } }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/auth/admin/users/1/role') {
      const body = await route.request().postDataJSON()
      users = users.map((user) => (user.id === 1 ? { ...user, roles: [body.role] } : user))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/auth/admin/users/2/deactivate') {
      users = users.map((user) => (user.id === 2 ? { ...user, is_active: false } : user))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    if (method === 'GET' && path === '/api/v1/auth/admin/auth/policy') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: authPolicy }),
      })
      return
    }

    if (method === 'PATCH' && path === '/api/v1/auth/admin/auth/policy') {
      const body = await route.request().postDataJSON()
      authPolicy = { two_factor_optional_enabled: Boolean(body.twoFactorOptionalEnabled) }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      return
    }

    await route.fallback()
  })

  await page.route('**/api/v1/auth/admin/auth/policy**', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: authPolicy }),
      })
      return
    }
    if (method === 'PATCH') {
      const body = await route.request().postDataJSON()
      authPolicy = { two_factor_optional_enabled: Boolean(body.twoFactorOptionalEnabled) }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/v1/auth/admin/rbac/roles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ name: 'veterinarian' }, { name: 'receptionist' }],
      }),
    })
  })

  await page.route('**/api/v1/auth/admin/rbac/orgs/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.includes('/overrides')) {
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: overrides }),
        })
        return
      }
      if (method === 'PUT') {
        overrides = [{ role: 'veterinarian', grant: ['patients.read', 'appointments.write'], revoke: [], updated: '2026-05-01T11:00:00Z' }]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
        return
      }
    }

    if (path.includes('/roles/')) {
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { name: 'veterinarian' } }),
        })
        return
      }
      if (method === 'PUT') {
        const body = await route.request().postDataJSON()
        overrides = [{
          role: 'veterinarian',
          grant: body.grant || [],
          revoke: body.revoke || [],
          updated: '2026-05-01T11:00:00Z',
        }]
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
        return
      }
      if (method === 'DELETE') {
        overrides = []
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
        return
      }
    }

    await route.fallback()
  })
}

async function mockPatients(page) {
  let species = [
    { id: 1, common_name: 'Perro', slug: 'perro' },
    { id: 2, common_name: 'Gato', slug: 'gato' },
  ]
  let patients = [
    {
      id: 11,
      name: 'Luna',
      species: 'Perro',
      species_id: 1,
      breed_name: 'Labrador',
      primary_owner: 'Ana Perez',
      owner_phone: '+54 9 11 5555-1111',
      birthdate: '2020-05-01',
      weight_kg: 22.5,
      chip_number: 'CHIP-1',
      sex: 'female',
      is_active: true,
    },
  ]

  await page.route('**/api/v1/patients/species/all', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: species }),
    })
  })

  await page.route('**/api/v1/patients**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path === '/api/v1/patients') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: patients,
          meta: { page: 1, totalPages: 1 },
        }),
      })
      return
    }

    if (method === 'POST' && path === '/api/v1/patients') {
      const body = await route.request().postDataJSON()
      patients = [
        {
          id: 12,
          name: body.name,
          species: 'Gato',
          species_id: 2,
          breed_name: 'Sin raza',
          primary_owner: 'Maria Garcia',
          owner_phone: '+54 9 11 2222-2222',
          birthdate: body.birthDate,
          weight_kg: body.weightKg,
          chip_number: body.microchipNumber,
          sex: body.sex,
          is_active: true,
        },
        ...patients,
      ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 12 } }),
      })
      return
    }

    if (method === 'PUT' && path === '/api/v1/patients/12') {
      const body = await route.request().postDataJSON()
      patients = patients.map((patient) => (patient.id === 12 ? { ...patient, name: body.name } : patient))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
      return
    }

    await route.fallback()
  })

  await page.route('**/api/v1/clients', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 99 } }),
      })
      return
    }

    await route.fallback()
  })
}

test('admin can manage policy, role overrides and user creation', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockAdmin(page)

  await page.goto('/admin')
  await expect(page.getByText('Ana Gomez')).toBeVisible()

  await page.getByRole('checkbox').check()
  await expect(page.getByText('Habilitado')).toBeVisible()

  const roleSelect = page.locator('tbody .role-select').first()
  await roleSelect.selectOption('receptionist')
  await expect(roleSelect).toHaveValue('receptionist')

  await page.locator('.rbac-controls .role-select').selectOption('veterinarian')
  await page.locator('.rbac-controls input').first().fill('appointments.write')
  await page.locator('.rbac-controls input').nth(1).fill('patients.write')
  await page.locator('.rbac-controls').getByRole('button', { name: 'Guardar override' }).click()
  await expect(page.getByText('appointments.write')).toBeVisible()

  await page.getByRole('button', { name: /Nuevo usuario/i }).click()
  const modal = page.getByRole('dialog', { name: /Nuevo usuario/i })
  const form = modal.locator('form')
  await form.locator('input[placeholder="Juan"]').fill('Bruno')
  await form.locator('input[placeholder="Perez"]').fill('Diaz')
  await form.locator('input[type="email"]').fill('bruno@example.com')
  await form.locator('select').first().selectOption('veterinarian')
  await form.locator('input[placeholder="+54 9 11 1234-5678"]').fill('+54 9 11 9999-9999')
  await form.locator('input[placeholder="VET-0001"]').fill('VET-1234')
  await form.getByRole('button', { name: /Crear usuario/i }).click()

  await expect(page.getByText('bruno@example.com')).toBeVisible()
})

test('patients can create and edit a patient', async ({ page }) => {
  await mockAuthenticatedSession(page)
  await mockPatients(page)

  await page.goto('/pacientes')
  await expect(page.getByText('Luna')).toBeVisible()

  await page.getByRole('button', { name: /Nuevo paciente/i }).click()
  const modal = page.locator('div.modal').first()
  const form = modal.locator('form')
  await form.locator('input[placeholder="Max"]').fill('Milo')
  await form.locator('select').nth(0).selectOption('2')
  await form.locator('select').nth(1).selectOption('male')
  await form.locator('input[type="date"]').fill('2021-06-01')
  await form.locator('input[placeholder="3.5"]').fill('4.2')
  await form.locator('input[placeholder="123456789012345"]').fill('CHIP-2')
  await form.locator('input[placeholder="María"]').fill('Maria')
  await form.locator('input[placeholder="García"]').fill('Lopez')
  await form.locator('input[placeholder="+54 9 11 1234-5678"]').fill('+54 9 11 7777-7777')
  await form.locator('input[placeholder="maria@email.com"]').fill('maria@example.com')
  await form.getByRole('button', { name: /Registrar paciente/i }).click()

  await expect(page.locator('.patient-card').filter({ hasText: 'Milo' })).toBeVisible()

  await page.getByRole('button', { name: /Editar/i }).first().click()
  const editForm = page.locator('div.modal').first().locator('form')
  await editForm.locator('input[placeholder="Max"]').fill('Milo Nuevo')
  await editForm.getByRole('button', { name: /Guardar cambios/i }).click()

  await expect(page.getByText('Milo Nuevo')).toBeVisible()
})
