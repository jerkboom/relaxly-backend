const mongoose = require('mongoose');

const referralClickSchema = new mongoose.Schema(
  {
    referralCode: {
      type: String,
      required: true,
      index: true
    },
    ipAddress: {
      type: String
    },
    userAgent: {
      type: String
    },
    device: {
      type: String
    },
    browser: {
      type: String
    },
    os: {
      type: String
    },
    country: {
      type: String
    },
    clickType: {
      type: String,
      enum: ['click', 'registration_started', 'hostel_view'],
      default: 'click',
      index: true
    },
    source: {
      type: String,
      enum: ['link', 'qr', 'whatsapp', 'telegram', 'facebook', 'twitter', 'email'],
      default: 'link',
      index: true
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AmbassadorCampaign',
      index: true
    },
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MarketingAsset',
      index: true
    }
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false }
  }
);

module.exports = mongoose.model('ReferralClick', referralClickSchema);
