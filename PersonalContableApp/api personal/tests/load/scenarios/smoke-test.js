// tests/load/scenarios/smoke-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const BASE_URL = 'http://localhost:3000';

  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
  });

  // Login (obtener token)
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: 'admin@local.com',
      password: 'admin1234',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'login has token': (r) => JSON.parse(r.body).data?.accessToken,
  });

  const token = loginRes.status === 200 ? JSON.parse(loginRes.body).data.accessToken : null;

  if (!token) {
    console.error('No se pudo obtener token');
    return;
  }

  // Consultar tablas (protegido)
  const tablesRes = http.get(`${BASE_URL}/api/v1/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  check(tablesRes, {
    'tables status is 200': (r) => r.status === 200,
    'tables returns array': (r) => Array.isArray(JSON.parse(r.body).data),
  });

  sleep(1);
}