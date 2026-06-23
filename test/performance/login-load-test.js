import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up to 50 concurrent users
    { duration: '1m', target: 100 },  // Ramp up to 100 concurrent users
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'], // 95% of authentication requests must complete within 800ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';

export default function () {
  const payload = JSON.stringify({
    email: 'test_student@relaxly.com',
    password: 'password123',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);

  check(res, {
    'login status is 200 or 401': (r) => [200, 401].includes(r.status),
  });

  sleep(1);
}
