// tests/load/config.js
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@local.com';
export const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'admin1234';
export const THRESHOLD_P95 = __ENV.THRESHOLD_P95 || 1000;
export const THRESHOLD_ERROR_RATE = __ENV.THRESHOLD_ERROR_RATE || 0.01;