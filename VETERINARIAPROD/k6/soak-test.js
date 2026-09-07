/**
 * k6 soak test — endurance: 20 VUs for 2 hours
 * Run: k6 run k6/soak-test.js -e BASE_URL=http://localhost:4050 -e TOKEN=...
 */
import http  from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus:      20,
  duration: '2h',
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
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
  http.get(`${BASE}/health`);
  http.get(`${BASE}/api/${V}/patients?limit=10`, authHeaders);
  check(http.get(`${BASE}/api/${V}/appointments?limit=10`, authHeaders), {
    'no server error': r => r.status < 500,
  });
  sleep(3);
}
