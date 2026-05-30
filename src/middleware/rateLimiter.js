const rateLimit = require('express-rate-limit');

// 1. Global API Limiter (Standard traffic)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Balanced limit for general API usage
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// 2. Strict Booking Limiter (Stops bot spam on heavy DB transactions)
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 5 booking attempts per minute (increased slightly for testing)
  message: {
    success: false,
    message: 'Booking attempt limit reached. Please wait a minute before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Admin Limiter (Keep dashboard stable)
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: 'Too many admin requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { globalLimiter, bookingLimiter, adminLimiter };
