import { test, expect } from '@playwright/test'

test('login screen renders required controls', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-page')).toBeVisible()
  await expect(page.getByTestId('login-email')).toBeVisible()
  await expect(page.getByTestId('login-password')).toBeVisible()
  await expect(page.getByTestId('login-submit')).toBeVisible()
  await expect(page.getByRole('button', { name: /Google Workspace/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Microsoft/i })).toBeVisible()
})

test('forgot password step can be opened and closed from login', async ({ page }) => {
  await page.goto('/login')

  await page.getByRole('button', { name: /Olvidaste tu contrase(n|ñ)a/i }).click()
  await expect(page.getByRole('heading', { name: /Recuperar contrasena|Recuperar contraseña/i })).toBeVisible()
  await expect(page.getByLabel(/Correo electronico|Correo electrónico/i)).toBeVisible()

  await page.getByRole('button', { name: /Volver/i }).click()
  await expect(page.getByTestId('login-submit')).toBeVisible()
})

test('root route shows the public landing when there is no session', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: /Probar gratis|Empezar/i }).first()).toBeVisible()
})

test('protected routes redirect to login when there is no session', async ({ page }) => {
  await page.goto('/pacientes')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-page')).toBeVisible()
})
