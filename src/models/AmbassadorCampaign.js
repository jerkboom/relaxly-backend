const mongoose = require('mongoose');

const ambassadorCampaignSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true
    },
    previewText: {
      type: String,
      trim: true
    },
    body: {
      type: String,
      required: true
    },
    ctaText: {
      type: String,
      trim: true
    },
    ctaLink: {
      type: String,
      trim: true
    },
    targetType: {
      type: String,
      required: true,
      enum: [
        'all',
        'university',
        'badge',
        'top_10',
        'top_25',
        'active_month',
        'inactive_30',
        'pending_payout',
        'recently_paid',
        'specific_ambassador'
      ]
    },
    filters: {
      university: String,
      badge: String,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        set: v => (v === '' ? undefined : v)
      }
    },
    assetIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketingAsset'
      }
    ],
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sent'],
      default: 'draft'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    scheduledFor: {
      type: Date
    },
    sentAt: {
      type: Date
    },
    recipientCount: {
      type: Number,
      default: 0
    },
    deliveryStats: {
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('AmbassadorCampaign', ambassadorCampaignSchema);
