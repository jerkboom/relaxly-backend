const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    type: {
      type: String,
      enum: [
        'system',
        'booking',
        'payment',
        'account',
        'admin',
        'finance',
      ],
      default: 'system',
      index: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true,
    },
    auditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAuditLog',
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
    },

    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({
  user: 1,
  read: 1,
  createdAt: -1,
});

notificationSchema.index({
  user: 1,
  type: 1,
  createdAt: -1,
});

notificationSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    sparse: true,
  }
);

module.exports = mongoose.model(
  'Notification',
  notificationSchema
);
