/**
 * k6 stress test — find breaking point: ramp to 200 VUs
 * Run: k6 run k6/stress-test.js -e BASE_URL=http://localhost:4050
 */
import http  from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 50  },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 150 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 0   },
  ],
  thresholds: {
    http_req_failed:   ['rate<0.10'],
    http_req_duration: ['p(95)<3000'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4050';

export default function () {
  const r = http.get(`${BASE}/health`);
  check(r, { 'ok': res => res.status < 500 });
  sleep(0.5);
}
