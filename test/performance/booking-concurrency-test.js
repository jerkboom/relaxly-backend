import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

export const options = {
  vus: Number(__ENV.VUS) || 50,
  iterations: Number(__ENV.ITERATIONS) || 50,
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const ROOM_ID = __ENV.ROOM_ID || '69ff859883633e5092882b89';
const HOSTEL_ID = __ENV.HOSTEL_ID || '69fdffed94984a196ba8b960';

const successfulBookings = new Counter('successful_bookings');
const duplicateBookings = new Counter('duplicate_bookings');
const soldOutBookings = new Counter('sold_out_bookings');
const rateLimited = new Counter('rate_limited');
const unexpectedErrors = new Counter('unexpected_errors');

const TOKENS = [];

export default function () {
  const token =
    TOKENS[(__VU - 1) % TOKENS.length] || __ENV.TOKEN;

  const payload = JSON.stringify({
    hostelId: HOSTEL_ID,
    roomId: ROOM_ID,
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

  check(res, {
    'request handled': (r) =>
      [200, 201, 400, 409, 429].includes(r.status),
  });

  try {
    const body = res.json();

    if (res.status === 200 || res.status === 201) {
      successfulBookings.add(1);
    } else if (
      body?.message?.toLowerCase().includes('already booked')
    ) {
      duplicateBookings.add(1);
    } else if (
      body?.message?.toLowerCase().includes('sold out')
    ) {
      soldOutBookings.add(1);
    } else if (res.status === 429) {
      rateLimited.add(1);
    } else {
      unexpectedErrors.add(1);
      console.log(`[UNEXPECTED STATUS ${res.status}] ${res.body}`);
    }
  } catch (err) {
    if (res.status === 429) {
      rateLimited.add(1);
    } else {
      unexpectedErrors.add(1);
      console.log(`[UNEXPECTED PARSE ERROR status=${res.status}] body=${res.body}`);
    }
  }

  sleep(0.2);
}