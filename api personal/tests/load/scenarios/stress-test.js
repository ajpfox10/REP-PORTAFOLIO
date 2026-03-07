// tests/load/scenarios/stress-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 200 },  // Subir rápido a 200
    { duration: '5m', target: 500 },  // Subir a 500
    { duration: '2m', target: 1000 }, // Subir a 1000 (a ver si aguanta)
    { duration: '2m', target: 0 },    // Bajar
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const BASE_URL = 'http://localhost:3000';

  // Login con admin (para no complicar)
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: 'admin@local.com',
      password: 'admin1234',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    console.error('Login falló en stress test');
    return;
  }

  const token = JSON.parse(loginRes.body).data.accessToken;

  // Endpoint público (no requiere auth) para medir baseline
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health is 200': (r) => r.status === 200 });

  // Endpoint con auth pesado (tables)
  const tablesRes = http.get(`${BASE_URL}/api/v1/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(tablesRes, { 'tables < 500': (r) => r.status < 500 });

  // Endpoint con búsqueda en personal
  const searchRes = http.get(`${BASE_URL}/api/v1/personal/search?q=admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(searchRes, { 'search < 500': (r) => r.status < 500 });

  sleep(0.1); // 100ms entre requests para estresar más
}