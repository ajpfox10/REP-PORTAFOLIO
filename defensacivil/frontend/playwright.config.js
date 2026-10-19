import { defineConfig } from '@playwright/test';

// Los e2e levantan la API real (base defensacivil_test, recreada con los
// scripts de database/init) y el build del frontend servido con vite preview.
const API_PORT = '4171';
const env = {
  APP_ENV: 'test',
  PORT: API_PORT,
  AUTO_IMPORT_DATA: 'false',
  RATE_LIMIT_AUTH_MAX: '1000',
  JWT_SECRET: process.env.JWT_SECRET || 'e2e_access_secret_que_tiene_mas_de_32_caracteres',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'e2e_refresh_secret_que_tiene_mas_de_32_caracteres',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  globalSetup: './e2e/global-setup.cjs',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'node ../backend/src/server.js',
      url: `http://localhost:${API_PORT}/api/health`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      env: { VITE_API_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
