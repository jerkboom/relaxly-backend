/**
 * ==================================================
 * Relaxly Backend
 * File: DeliveryLog.js
 *
 * Purpose:
 * Provides a granular audit trail for every message
 * sent to a user. Tracks real-time delivery status
 * and user engagement (opens, clicks).
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * DeliveryLog Model
 *
 * Stores the final outcome and engagement data for communication.
 * Unlike the queue, which is transient, logs are permanent records.
 */
const deliveryLogSchema = new mongoose.Schema({
  // The campaign that initiated this message
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  // The targeted user
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The communication channel used
  channel: { 
    type: String, 
    enum: ['APP', 'EMAIL', 'SMS', 'DASHBOARD'], 
    required: true,
    set: v => String(v).toUpperCase().replace('DASHBOARD', 'APP')
  },
  // Detailed lifecycle status of the individual message
  status: { 
    type: String, 
    enum: ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'OPENED', 'CLICKED'], 
    default: 'PENDING',
    set: v => String(v).toUpperCase()
  },
  // Captured failure reason from the provider
  errorMessage: { type: String },
  // Timestamps for each stage of the message lifecycle
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  openedAt: { type: Date },
  clickedAt: { type: Date },
  // External ID provided by SMTP or SMS gateway for tracking
  referenceId: { type: String }, 
  // Contextual data (e.g., link clicked, email subject)
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

// Indexes for campaign performance reports and user message history
deliveryLogSchema.index({ campaign: 1, status: 1 });
deliveryLogSchema.index({ user: 1, channel: 1 });

module.exports = mongoose.model('DeliveryLog', deliveryLogSchema);
