// jest.config.cjs
const argv = process.argv.join(' ');
const isIntegrationRun =
  argv.includes('tests/integration') ||
  argv.includes('test:integration') ||
  process.env.TEST_INTEGRATION === '1';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],

  // ✅ corre ANTES de importar cualquier cosa del proyecto (clave para métricas)
  setupFiles: ['<rootDir>/tests/jest.env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],

  globalSetup: '<rootDir>/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',

  // ✅ En integración: no romper por thresholds globales
  collectCoverage: !isIntegrationRun,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**/*.ts',
    '!src/routes/auto/**/*.ts',
    '!src/server.ts',
    '!src/app.ts'
  ],

  ...(isIntegrationRun
    ? {}
    : {
        coverageThreshold: {
          global: {
            branches: 70,
            functions: 75,
            lines: 80,
            statements: 80
          }
        }
      }),

  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
};
