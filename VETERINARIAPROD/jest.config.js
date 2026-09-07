'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/'],
  collectCoverageFrom: [
    'shared/**/*.js',
    'gateway/src/**/*.js',
    'services/*/src/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  globalSetup:    './tests/setup/globalSetup.js',
  globalTeardown: './tests/setup/globalTeardown.js',
  testTimeout: 30000,
  verbose: true,
};
