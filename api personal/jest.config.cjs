/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/jest.setup.ts"],
  verbose: true,

  // 👇 lo que agregamos/cambiamos
  testTimeout: 20000,
  detectOpenHandles: true,
  forceExit: true,
};
