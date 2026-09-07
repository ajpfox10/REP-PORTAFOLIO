'use strict';

/**
 * Jest global setup — runs once before all test suites.
 * Sets environment variables for test DB/Redis.
 */
module.exports = async function globalSetup() {
  process.env.NODE_ENV      = 'test';
  process.env.JWT_SECRET    = 'test-secret-key-32chars-minimum!!';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-32chars!!';
  process.env.DB_HOST       = process.env.TEST_DB_HOST || 'localhost';
  process.env.DB_PORT       = process.env.TEST_DB_PORT || '3306';
  process.env.DB_USER       = process.env.TEST_DB_USER || 'root';
  process.env.DB_PASSWORD   = process.env.TEST_DB_PASSWORD || '';
  process.env.DB_NAME       = process.env.TEST_DB_NAME || 'vetmanager_test';
  process.env.REDIS_HOST    = process.env.TEST_REDIS_HOST || 'localhost';
  process.env.LOG_TO_FILE   = 'false';
};
