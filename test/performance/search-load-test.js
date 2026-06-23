import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp up to 100 concurrent users
    { duration: '1m', target: 300 },  // Ramp up to 300 concurrent users
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'], // 95% of requests must complete within 600ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const QUERIES = ['pentagon', 'madina', 'accra', 'carb', 'carbarns'];

export default function () {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  
  // Test search index performance
  const res = http.get(`${BASE_URL}/api/hostels?search=${query}`);
  check(res, {
    'search status is 200': (r) => r.status === 200,
  });

  // Test suggestion generation performance
  const suggestionRes = http.get(`${BASE_URL}/api/hostels/search-suggestions?q=${query}`);
  check(suggestionRes, {
    'suggestions status is 200': (r) => r.status === 200,
  });
  
  sleep(1);
}
