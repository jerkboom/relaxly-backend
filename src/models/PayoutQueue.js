const mongoose = require('mongoose');

const payoutQueueSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: true,
    },
    transferMethod: {
      type: String,
      enum: ['momo', 'bank'],
    },
    provider: String, // e.g. 'MTN', 'Vodafone'
    bankName: String,
    accountNumber: String,
    accountName: String,
    payoutMethod: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayoutMethod',
    },
        grossAmount: { type: Number },
    platformFee: { type: Number },
    netAmount: { type: Number },
    amount: {
      type: Number,
      required: [true, 'Payout gross amount is required'],
    },
    commissionAmount: {
      type: Number,
      required: [true, 'Commission amount is required'],
    },
    paystackFee: {
      type: Number,
      required: [true, 'Paystack fee is required'],
    },
    finalTransferAmount: {
      type: Number,
      required: [true, 'Final transfer amount is required'],
    },
    recipientCode: {
      type: String,
      trim: true,
      index: true,
    },
    currency: {
      type: String,
      default: 'GHS',
      required: true,
    },
    integrityStatus: { type: String, enum: ["valid", "corrupted"], default: "valid" },
    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'processing',
        'otp_pending',
        'paid',
        'failed',
        'otp_failed',
        'cancelled',
      ],
      default: 'pending',
      index: true,
    },
    transferCode: {
      type: String,
      trim: true,
    },
    transferReference: {
      type: String,
      trim: true,
    },
    otpRequired: {
      type: Boolean,
      default: false,
    },
    otpVerifiedAt: {
      type: Date,
    },
    adminApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    adminApprovedAt: {
      type: Date,
    },
    processedAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    paystackTransferCode: {
      type: String,
      trim: true,
    },
    paystackTransferReference: {
      type: String,
      trim: true,
    },
    failureReason: {
      type: String,
      trim: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

payoutQueueSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PayoutQueue', payoutQueueSchema);
