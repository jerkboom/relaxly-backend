/**
 * ==================================================
 * Relaxly Backend
 * File: Campaign.js
 *
 * Purpose:
 * Defines the Campaign model for mass communication
 * and targeted marketing efforts via various channels
 * (App, Email, SMS).
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * Campaign Model
 *
 * Stores configuration and execution status for communication campaigns.
 * Allows administrators to broadcast messages to specific user segments.
 */
const campaignSchema = new mongoose.Schema({
  // Descriptive name for the campaign
  name: { type: String, required: true },
  // The message template used for this campaign
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageTemplate' },
  // Segment of users who will receive the message
  audience: {
    type: { 
      type: String, 
      enum: ['ALL', 'STUDENTS', 'OWNERS', 'SPECIFIC_USERS', 'SEGMENT', 'DIRECT'], 
      required: true,
      set: v => String(v).toUpperCase()
    },
    // Granular filters to narrow down the audience
    filters: {
      university: String,
      hostel: mongoose.Schema.Types.ObjectId,
      verificationStatus: String,
      revenueTier: String,
      specificUserIds: [mongoose.Schema.Types.ObjectId]
    }
  },
  // Communication mediums (e.g., In-app notifications, Email, SMS)
  channels: [{ 
    type: String, 
    enum: ['APP', 'EMAIL', 'SMS', 'DASHBOARD'],
    set: v => String(v).toUpperCase()
  }],
  // Delivery importance level
  priority: { 
    type: String, 
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'EMERGENCY'], 
    default: 'MEDIUM',
    set: v => String(v).toUpperCase()
  },
  // Current state of the campaign
  status: { 
    type: String, 
    enum: ['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'FAILED', 'CANCELLED'], 
    default: 'DRAFT',
    set: v => String(v).toUpperCase()
  },
  // When the campaign should start sending
  scheduledAt: { type: Date },
  // When the last message was dispatched
  sentAt: { type: Date },
  
  /**
   * STATS
   * Aggregated metrics for performance tracking.
   */
  stats: {
    targetCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 }
  },
  
  // Administrator who created the campaign
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema);
