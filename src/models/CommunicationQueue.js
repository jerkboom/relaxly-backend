/**
 * ==================================================
 * Relaxly Backend
 * File: CommunicationQueue.js
 *
 * Purpose:
 * Manages the asynchronous dispatch of messages
 * across various channels. Ensures reliable delivery
 * with retry logic and priority handling.
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * CommunicationQueue Model
 *
 * Acting as a buffer for outgoing messages. This allows the system
 * to process high-volume campaign sends without blocking or crashing.
 *
 * Features:
 * - Retry logic (maxAttempts)
 * - Priority-based dispatch
 * - Logging of failed delivery attempts
 */
const communicationQueueSchema = new mongoose.Schema({
  // The campaign that generated this message (if any)
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  // The recipient of the message
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The delivery medium
  channel: { 
    type: String, 
    enum: ['APP', 'EMAIL', 'SMS', 'DASHBOARD'], 
    required: true,
    set: v => String(v).toUpperCase().replace('DASHBOARD', 'APP')
  },
  // The content and metadata of the message (Title, Body, etc.)
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  // Current delivery status
  status: { 
    type: String, 
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'], 
    default: 'PENDING',
    set: v => String(v).toUpperCase()
  },
  // Counter for delivery retries
  attempts: { type: Number, default: 0 },
  // Maximum number of retries before marking as permanently failed
  maxAttempts: { type: Number, default: 3 },
  // Scheduling for the next retry attempt
  nextAttemptAt: { type: Date, default: Date.now },
  // History of errors encountered during delivery
  errorLogs: [{ type: String }],
  // Sorting order for the dispatcher (higher = sooner)
  priority: { type: Number, default: 0 } 
}, { timestamps: true });

// Optimized index for the background worker to find messages ready for dispatch
communicationQueueSchema.index({ status: 1, nextAttemptAt: 1, priority: -1 });

module.exports = mongoose.model('CommunicationQueue', communicationQueueSchema);
