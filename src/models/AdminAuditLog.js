/**
 * ==================================================
 * Relaxly Backend
 * File: AdminAuditLog.js
 *
 * Purpose:
 * Records every administrative action for accountability
 * and security monitoring. Ensures immutable audit trails.
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * AdminAuditLog Model
 *
 * Stores a historical record of actions taken by
 * administrators (or system processes acting as admins).
 *
 * Key features:
 * - Immutability (no edits or deletes allowed)
 * - Severity tracking
 * - Targeting specific platform entities (Hostels, Users, etc.)
 */
const adminAuditLogSchema = new mongoose.Schema(
  {
    // The administrative entity that performed the action
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'adminModel',
      index: true,
    },
    // Dynamic reference to either a standard User or a specialized Admin model
    adminModel: {
      type: String,
      required: true,
      enum: ['User', 'Admin'],
      default: 'User',
    },
    // Descriptive string of the action (e.g., 'HOSTEL_APPROVE')
    actionType: {
      type: String,
      required: true,
      index: true,
    },
    // Impact level of the action
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low',
      index: true,
    },
    // The type of platform entity affected by this action
    targetType: {
      type: String,
      required: true,
      enum: ['User', 'Admin', 'Hostel', 'PlatformSettings', 'Booking', 'Transaction', 'PayoutQueue', 'System', 'Auth'],
    },
    // The specific database ID of the affected entity
    targetId: {
      type: mongoose.Schema.Types.Mixed,
      index: true,
    },
    // Captured state before/after or additional context
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    // Whether the action succeeded or failed
    status: {
      type: String,
      enum: ['success', 'failure', 'attempt'],
      default: 'success',
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Enforcement of Immutability: Prevention of Edits
 */
adminAuditLogSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('Audit logs are immutable and cannot be modified.');
  }
});

/**
 * Enforcement of Immutability: Prevention of Deletions
 */
const blockDelete = function () {
  throw new Error('Audit logs are immutable and cannot be deleted.');
};

adminAuditLogSchema.pre('remove', blockDelete);
adminAuditLogSchema.pre('deleteOne', blockDelete);
adminAuditLogSchema.pre('deleteMany', blockDelete);
adminAuditLogSchema.pre('findOneAndDelete', blockDelete);

// Indexes for fast searching in the admin dashboard
adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ severity: 1, createdAt: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
