# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.js >> forgot password step can be opened and closed from login
- Location: tests\e2e\login.spec.js:14:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: /Olvidaste tu contrasena|Olvidaste tu contraseña/i })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - img:
    - generic:
      - generic: "5"
      - generic: "4"
      - generic: "3"
      - generic: "2"
      - generic: "1"
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - img [ref=e7]
        - generic [ref=e29]:
          - generic [ref=e30]: Sistema
          - generic [ref=e31]: Andromeda
      - paragraph [ref=e32]: Veterinary management system
    - generic [ref=e33]:
      - generic [ref=e34]:
        - generic [ref=e35]: Correo electrónico
        - textbox "Correo electrónico" [ref=e36]:
          - /placeholder: usuario@veterinaria.com
      - generic [ref=e37]:
        - generic [ref=e38]: Contraseña
        - generic [ref=e39]:
          - textbox "Contraseña" [ref=e40]:
            - /placeholder: ••••••••••
          - button "Show" [ref=e41] [cursor=pointer]: 👁️
      - button "Sign in" [ref=e42] [cursor=pointer]:
        - generic [ref=e43]: Sign in
      - generic [ref=e44]:
        - paragraph [ref=e45]: or sign in with your corporate directory
        - generic [ref=e46]:
          - button "Google Workspace" [ref=e47] [cursor=pointer]
          - button "Microsoft" [ref=e48] [cursor=pointer]
      - button "Forgot your password?" [ref=e50] [cursor=pointer]
  - paragraph [ref=e51]: © 2026 Sistema Andromeda
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test('login screen renders required controls', async ({ page }) => {
  4  |   await page.goto('/login')
  5  | 
  6  |   await expect(page.getByTestId('login-page')).toBeVisible()
  7  |   await expect(page.getByTestId('login-email')).toBeVisible()
  8  |   await expect(page.getByTestId('login-password')).toBeVisible()
  9  |   await expect(page.getByTestId('login-submit')).toBeVisible()
  10 |   await expect(page.getByRole('button', { name: /Google Workspace/i })).toBeVisible()
  11 |   await expect(page.getByRole('button', { name: /Microsoft/i })).toBeVisible()
  12 | })
  13 | 
  14 | test('forgot password step can be opened and closed from login', async ({ page }) => {
  15 |   await page.goto('/login')
  16 | 
> 17 |   await page.getByRole('link', { name: /Olvidaste tu contrasena|Olvidaste tu contraseña/i }).click()
     |                                                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  18 |   await expect(page.getByRole('heading', { name: /Recuperar contrasena|Recuperar contraseña/i })).toBeVisible()
  19 |   await expect(page.getByLabel(/Correo electronico|Correo electrónico/i)).toBeVisible()
  20 | 
  21 |   await page.getByRole('button', { name: /Volver/i }).click()
  22 |   await expect(page.getByTestId('login-submit')).toBeVisible()
  23 | })
  24 | 
  25 | test('protected root route redirects to login when there is no session', async ({ page }) => {
  26 |   await page.goto('/')
  27 | 
  28 |   await expect(page).toHaveURL(/\/login$/)
  29 |   await expect(page.getByTestId('login-page')).toBeVisible()
  30 | })
  31 | 
```