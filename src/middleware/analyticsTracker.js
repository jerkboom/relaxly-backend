const asyncHandler = require('express-async-handler');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const crypto = require('crypto');

const analyticsTracker = asyncHandler(async (req, res, next) => {
  // Only track GET requests that are page views or specific API reads
  if (req.method !== 'GET') {
    return next();
  }

  // Skip static assets, admin calls (unless we specifically want to track them, but usually we track public/frontend)
  // Let's track everything under /api but identify role
  
  // Generate a session ID based on IP and User-Agent (simple fingerprinting)
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  const sessionId = crypto.createHash('md5').update(`${ip}-${userAgent}`).digest('hex');

  let role = 'guest';
  let userId = null;

  if (req.user) {
    role = req.user.role;
    userId = req.user.id;
  }

  // Determine event type based on path
  let eventType = 'page_view';
  let page = req.originalUrl;

  if (page.includes('/api/hostels') && !page.includes('/admin')) {
    eventType = 'hostel_view';
  } else if (page.includes('/api/bookings') && req.method === 'POST') {
    eventType = 'booking_request'; // This would need to be tracked in the booking controller or a POST middleware
  } else if (page.includes('/api/search')) {
    eventType = 'search';
  }

  // We don't want to block the request, fire and forget
  try {
    // Basic rate limiting/deduplication for the same page view from same session within 1 minute
    const recentEvent = await AnalyticsEvent.findOne({
      sessionId,
      page,
      createdAt: { $gte: new Date(Date.now() - 60000) }
    });

    if (!recentEvent) {
      await AnalyticsEvent.create({
        userId,
        role,
        eventType,
        page,
        ip,
        userAgent,
        sessionId
      });
    }
  } catch (error) {
    console.error('Analytics tracking error:', error.message);
  }

  next();
});

module.exports = analyticsTracker;