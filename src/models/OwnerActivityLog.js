const mongoose = require('mongoose');

const ownerActivityLogSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // The person performing the action (Owner, Admin, or 'System')
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    actorName: String,
    actorRole: {
      type: String,
      enum: ['owner', 'admin', 'super_admin', 'moderator', 'support_admin', 'system'],
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Compound index for fast timeline retrieval
ownerActivityLogSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('OwnerActivityLog', ownerActivityLogSchema);
