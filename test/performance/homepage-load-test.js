import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp up to 100 concurrent users
    { duration: '1m', target: 500 },  // Ramp up to 500 concurrent users
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete within 500ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';

export default function () {
  const res = http.get(`${BASE_URL}/api/hostels`);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  
  sleep(1);
}
