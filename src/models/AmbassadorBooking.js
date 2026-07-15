const mongoose = require('mongoose');

const ambassadorBookingSchema = new mongoose.Schema(
  {
    ambassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredStudent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true, // Strict 1-to-1 relationship to prevent duplicate claims
    },
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: true,
    },
    university: {
      type: String,
      required: true,
      index: true,
    },
    bookingAmount: {
      type: Number,
      required: true,
    },
    commissionType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    commissionRate: {
      type: Number,
      required: true,
    },
    commissionAmount: {
      type: Number,
      required: true,
    },
    bonusCampaignApplied: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AmbassadorCampaign',
    },
    bonusAmountEarned: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },
    paidAt: Date,
    payoutReference: String,
    statusLogs: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: String,
        reason: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

ambassadorBookingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AmbassadorBooking', ambassadorBookingSchema);
