/**
 * k6 load test — realistic traffic: ramp to 50 VUs over 5 min
 * Run: k6 run k6/load-test.js -e BASE_URL=http://localhost:4050 -e TOKEN=...
 */
import http    from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '2m', target: 20 },   // ramp up
    { duration: '5m', target: 50 },   // sustain
    { duration: '2m', target: 0  },   // ramp down
  ],
  thresholds: {
    http_req_failed:   ['rate<0.02'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  },
};

const BASE  = __ENV.BASE_URL    || 'http://localhost:4050';
const V     = __ENV.API_VERSION || 'v1';
const TOKEN = __ENV.TOKEN       || '';

const authHeaders = {
  headers: {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${TOKEN}`,
  },
};

export default function () {
  group('health', () => {
    const r = http.get(`${BASE}/health`);
    check(r, { 'health 200': res => res.status === 200 });
  });

  group('patients list', () => {
    const r = http.get(`${BASE}/api/${V}/patients?page=1&limit=20`, authHeaders);
    check(r, { 'patients 200': res => res.status === 200 });
  });

  group('appointments list', () => {
    const r = http.get(`${BASE}/api/${V}/appointments?date=2026-03-23`, authHeaders);
    check(r, { 'appointments 200|401': res => [200, 401].includes(res.status) });
  });

  sleep(Math.random() * 3 + 1);
}
