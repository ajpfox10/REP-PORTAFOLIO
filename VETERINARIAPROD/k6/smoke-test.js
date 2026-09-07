/**
 * k6 smoke test — quick sanity check: 1 VU, 1 minute
 * Run: k6 run k6/smoke-test.js -e BASE_URL=http://localhost:4050
 */
import http    from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus:      1,
  duration: '1m',
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4050';
const V    = __ENV.API_VERSION || 'v1';

export default function () {
  // Health check
  const health = http.get(`${BASE}/health`);
  check(health, { 'health 200': r => r.status === 200 });

  // Login
  const login = http.post(
    `${BASE}/api/${V}/auth/login`,
    JSON.stringify({ email: __ENV.TEST_EMAIL || 'admin@test.com', password: __ENV.TEST_PASS || 'Admin123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(login, { 'login 200': r => r.status === 200 });

  sleep(1);
}
