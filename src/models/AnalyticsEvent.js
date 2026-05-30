/**
 * ==================================================
 * Relaxly Backend
 * File: AnalyticsEvent.js
 *
 * Purpose:
 * Captures user interactions and system events
 * for traffic analysis, conversion funnels,
 * and user behavior tracking.
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * AnalyticsEvent Model
 *
 * Stores granular event data triggered by users (authenticated or guests).
 *
 * Use cases:
 * - Tracking hostel view counts
 * - Measuring booking abandonment rates
 * - Analyzing popular universities/locations
 */
const analyticsEventSchema = new mongoose.Schema({
  // The user who triggered the event (null for guests)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Role of the user at the time of the event
  role: { type: String, enum: ['student', 'owner', 'admin', 'super_admin', 'finance_admin', 'moderator', 'support_admin', 'guest'], default: 'guest' },
  // Short identifier for the action (e.g., 'PAGE_VIEW', 'HOSTEL_CLICK')
  eventType: { type: String, required: true },
  // The URL or component name where the event occurred
  page: { type: String, required: true },
  ip: { type: String },
  userAgent: { type: String },
  // Unique identifier for the browser session
  sessionId: { type: String },
  // Context-specific details (e.g., { hostelId: '...' })
  metadata: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: true
});

// Optimized indexes for analytics dashboard queries
analyticsEventSchema.index({ createdAt: -1 });
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ sessionId: 1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);