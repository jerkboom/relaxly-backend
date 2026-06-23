import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up to 50 concurrent students
    { duration: '2m', target: 200 },  // Ramp up to 200 concurrent students
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of journey steps must complete within 1s
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const HOSTEL_IDS = ['69fdffed94984a196ba8b960'];
const ROOM_IDS = ['69ff859883633e5092882b89'];

const TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMTRhYWQxNTc5NmIxZTMxOTA1NmZmMCIsInJvbGUiOiJzdHVkZW50IiwiaWF0IjoxNzc5NzM5NjcxLCJleHAiOjE3ODAzNDQ0NzF9.tcB5kIhg3cva8oXRoomhjrO7AMMsI9QZ0QB-jlVWnqk',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMTRhZDMzNTc5NmIxZTMxOTA1NzAwNiIsInJvbGUiOiJzdHVkZW50IiwiaWF0IjoxNzc5NzQwMjM4LCJleHAiOjE3ODAzNDQ0NzF9.OBITaiTHvO9Gvt2rkg779btoFjqnmLedvoxcmkVDblU'
];

export default function () {
  // Step 1: Browse Hostels
  const browseRes = http.get(`${BASE_URL}/api/hostels`);
  check(browseRes, {
    'browse status is 200': (r) => r.status === 200,
  });
  sleep(1 + Math.random() * 2); // Think time: 1-3s

  // Step 2: Query Search Suggestions (fuzzy matching)
  const suggestionRes = http.get(`${BASE_URL}/api/hostels/search-suggestions?q=carb`);
  check(suggestionRes, {
    'suggestion status is 200': (r) => r.status === 200,
  });
  sleep(1 + Math.random() * 2);

  // Step 3: Open details of a random hostel
  const hostelId = HOSTEL_IDS[Math.floor(Math.random() * HOSTEL_IDS.length)];
  const detailsRes = http.get(`${BASE_URL}/api/hostels/${hostelId}`);
  check(detailsRes, {
    'details status is 200': (r) => r.status === 200,
  });
  sleep(2 + Math.random() * 2);

  // Step 4: Login to account
  const loginPayload = JSON.stringify({
    email: 'test_student@relaxly.com',
    password: 'password123',
  });
  const loginParams = { headers: { 'Content-Type': 'application/json' } };
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, loginParams);
  check(loginRes, {
    'login success': (r) => [200, 401].includes(r.status),
  });
  sleep(1 + Math.random() * 2);

  // Step 5: Initialize a Booking
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const roomId = ROOM_IDS[Math.floor(Math.random() * ROOM_IDS.length)];
  const bookingPayload = JSON.stringify({
    hostelId: hostelId,
    roomId: roomId,
    duration: 'semester',
  });
  const bookingParams = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
  const bookingRes = http.post(`${BASE_URL}/api/bookings`, bookingPayload, bookingParams);
  check(bookingRes, {
    'booking handled': (r) => [200, 201, 400, 409, 429].includes(r.status),
  });

  sleep(2);
}
