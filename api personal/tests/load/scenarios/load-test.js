// tests/load/scenarios/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },  // Subir a 10 usuarios
    { duration: '2m', target: 50 },  // Subir a 50 usuarios
    { duration: '3m', target: 100 }, // Subir a 100 usuarios
    { duration: '2m', target: 50 },  // Bajar a 50
    { duration: '1m', target: 0 },   // Bajar a 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

// Pool de DNIs para simular diferentes usuarios
const dnis = [12345678, 87654321, 11223344, 55667788, 99887766];

export default function () {
  const BASE_URL = 'http://localhost:3000';
  const dni = dnis[randomIntBetween(0, dnis.length - 1)];

  // Login con diferentes usuarios (simulado)
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: `user${dni}@test.com`,
      password: 'test1234',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  // Si falla login, intentamos con admin
  let token;
  if (loginRes.status === 200) {
    token = JSON.parse(loginRes.body).data.accessToken;
  } else {
    const adminLogin = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({
        email: 'admin@local.com',
        password: 'admin1234',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    token = adminLogin.status === 200 ? JSON.parse(adminLogin.body).data.accessToken : null;
  }

  if (!token) {
    console.error('No se pudo obtener token');
    return;
  }

  // Consultas aleatorias
  const endpoints = [
    { method: 'GET', url: '/api/v1/tables' },
    { method: 'GET', url: '/api/v1/documents?limit=10' },
    { method: 'GET', url: `/api/v1/personal/search?dni=${dni}` },
    { method: 'GET', url: `/api/v1/eventos/dni/${dni}` },
  ];

  const endpoint = endpoints[randomIntBetween(0, endpoints.length - 1)];

  const res = http.get(`${BASE_URL}${endpoint.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  check(res, {
    [`${endpoint.method} ${endpoint.url} status < 500`]: (r) => r.status < 500,
  });

  sleep(randomIntBetween(1, 3));
}