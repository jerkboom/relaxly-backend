const mongoose = require('mongoose');

const ambassadorCampaignRecipientSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AmbassadorCampaign',
      required: true,
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    emailAddress: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed'],
      default: 'pending'
    },
    opened: {
      type: Boolean,
      default: false
    },
    clicked: {
      type: Boolean,
      default: false
    },
    openedAt: {
      type: Date
    },
    clickedAt: {
      type: Date
    },
    error: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('AmbassadorCampaignRecipient', ambassadorCampaignRecipientSchema);
