// tests/load/scenarios/soak-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30m', // 30 minutos para ver fugas de memoria
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const BASE_URL = 'http://localhost:3000';

  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: 'admin@local.com',
      password: 'admin1234',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    return;
  }

  const token = JSON.parse(loginRes.body).data.accessToken;

  // Rotar entre diferentes endpoints
  const r = Math.random();

  if (r < 0.3) {
    http.get(`${BASE_URL}/api/v1/tables`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else if (r < 0.6) {
    http.get(`${BASE_URL}/api/v1/documents?limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    http.get(`${BASE_URL}/api/v1/eventos/dni/12345678`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  sleep(2);
}