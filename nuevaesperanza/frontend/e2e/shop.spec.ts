import { expect, test, type Page } from '@playwright/test'

const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@nuevaesperanza.test', password: process.env.ADMIN_PASSWORD ?? 'Admin.Nueva2026' }

async function login(page: Page, email: string, password: string) {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

test('un visitante busca productos y filtra por categoría', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Tu compra del súper/ })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('yerba')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/q=yerba/)
  await expect(page.getByRole('link', { name: 'Yerba mate suave' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: 'Lácteos' }).click()
  await expect(page.getByRole('heading', { name: 'Lácteos', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Leche entera' })).toBeVisible()
})

test('un cliente nuevo arma el carrito, se registra y hace su pedido', async ({ page }) => {
  const email = `e2e${Date.now()}@cliente.test`

  await page.goto('/productos?categoria=almacen')
  await page.getByRole('button', { name: 'Agregar Arroz largo fino al carrito' }).click()
  await page.getByRole('link', { name: 'Yerba mate suave' }).click()
  await page.locator('.detail__buy').getByRole('button', { name: 'Agregar uno' }).click()
  await page.getByRole('button', { name: /Agregar al carrito/ }).click()

  await page.getByRole('button', { name: /Abrir carrito, 3 productos/ }).click()
  const drawer = page.getByRole('dialog', { name: 'Tu carrito' })
  await expect(drawer.getByText('Arroz largo fino')).toBeVisible()
  await expect(drawer.getByText(/para el envío gratis/)).toBeVisible()
  await drawer.getByRole('button', { name: 'Finalizar compra' }).click()

  // El checkout pide cuenta: se registra y vuelve
  await expect(page).toHaveURL(/ingresar/)
  await page.getByRole('link', { name: 'Creala gratis' }).click()
  await page.getByLabel('Nombre y apellido').fill('Prueba Automática')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('Clave1234')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()

  await expect(page.getByRole('heading', { name: 'Finalizar compra' })).toBeVisible()
  await page.getByLabel('Dirección de entrega').fill('Av. Siempre Viva 742')
  await page.getByLabel('Teléfono de contacto').fill('11 4444-5555')
  await page.getByText('Transferencia', { exact: true }).click()
  await page.getByRole('button', { name: /Confirmar pedido/ }).click()

  await expect(page.getByText('¡Gracias por tu compra!')).toBeVisible()
  await expect(page.getByRole('cell', { name: /Yerba mate suave/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Abrir carrito, 0 productos/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancelar pedido' })).toBeVisible()

})

test('el panel pide sesión y el administrador avanza un pedido', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/ingresar/)

  await login(page, ADMIN.email, ADMIN.password)
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
  await expect(page.getByText('Ventas por día')).toBeVisible()

  await page.getByRole('navigation', { name: 'Administración' }).getByRole('link', { name: 'Pedidos' }).click()
  await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Recibido' }).click()
  await page.locator('.table tbody tr').first().click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Empezar a preparar' }).click()
  await expect(page.getByText(/en preparación/i).first()).toBeVisible()
})
