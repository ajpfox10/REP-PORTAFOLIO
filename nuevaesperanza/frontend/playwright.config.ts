import { defineConfig } from '@playwright/test'

// Los e2e usan la API real sirviendo el build del frontend, con la base de
// datos indicada por las variables DB_* (ver README).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npm run build && node ../backend/src/server.js',
    url: 'http://localhost:4173/api/health',
    env: { PORT: '4173' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
