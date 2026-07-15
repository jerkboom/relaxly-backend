/**
 * Centralized App Configuration for Relaxly Backend.
 * Exports consistent URLs to prevent localhost leaks in emails and tracking pixels.
 */

const BACKEND_URL = process.env.APP_URL;
if (!BACKEND_URL) {
  console.warn('[config] WARNING: APP_URL is not set. Backend-generated links (receipts, QR codes) may be broken in production.');
}

module.exports = {
  FRONTEND_URL: (process.env.FRONTEND_URL || 'https://relaxlygh.com').replace(/\/$/, ''),
  BACKEND_URL: (BACKEND_URL || 'http://localhost:5000').replace(/\/$/, ''),
};

