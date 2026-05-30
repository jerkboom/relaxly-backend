import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 2,           // Exactly 2 Virtual Users
  iterations: 2,    // Exactly 2 requests total (1 per user)
};

const BASE_URL = 'http://localhost:5000';

// Your two specific JWTs
const TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMTRhYWQxNTc5NmIxZTMxOTA1NmZmMCIsInJvbGUiOiJzdHVkZW50IiwiaWF0IjoxNzc5NzM5NjcxLCJleHAiOjE3ODAzNDQ0NzF9.tcB5kIhg3cva8oXRoomhjrO7AMMsI9QZ0QB-jlVWnqk',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMTRhZDMzNTc5NmIxZTMxOTA1NzAwNiIsInJvbGUiOiJzdHVkZW50IiwiaWF0IjoxNzc5NzQwMjM4LCJleHAiOjE3ODAzNDUwMzh9.OBITaiTHvO9Gvt2rkg779btoFjqnmLedvoxcmkVDblU'
];

export default function () {
  // Map VU 1 to the first token, and VU 2 to the second token
  const token = TOKENS[__VU - 1]; 

  const payload = JSON.stringify({
    hostelId: '69fdffed94984a196ba8b960',
    roomId: '69ff859883633e5092882b89',
    duration: 'semester',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  const res = http.post(
    `${BASE_URL}/api/bookings`,
    payload,
    params
  );

  console.log(`VU ${__VU} -> ${res.status}`);

  check(res, {
    'handled safely': (r) => [200, 201, 400, 409].includes(r.status),
  });
}