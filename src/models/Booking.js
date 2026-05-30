/**
 * ==================================================
 * Relaxly Backend
 * File: Booking.js
 *
 * Purpose:
 * Defines the Booking model, which acts as the central
 * record for reservations, student-hostel relationships,
 * and financial snapshots.
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');

/**
 * Booking Model
 *
 * Stores all information related to a hostel reservation,
 * including a permanent financial snapshot at the time of booking.
 *
 * Key relationships:
 * - Student (User)
 * - Hostel
 * - Room
 */
const bookingSchema = new mongoose.Schema(
  {
    // The student making the reservation
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // The specific room variant being booked
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
    },

    // The hostel where the room is located
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: true,
    },

    // Human-readable reference (e.g., BK-XXXXXXXX)
    bookingCode: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Lifecycle status of the reservation
    bookingStatus: {
      type: String,
      enum: [
        'pending',
        'approved',
        'cancelled',
        'completed', 'checked-in',
        'rejected',
        'expired',
      ],
      default: 'pending',
    },

    // Payment lifecycle status
    paymentStatus: {
      type: String,
      enum: [
        'pending',
        'paid',
        'failed',
        'cancelled',
        'abandoned',
        'expired',
      ],
      default: 'pending',
    },

    // Total amount the student is expected to pay (including fees)
    amount: {
      type: Number,
      required: true,
    },

    /**
     * FINANCIAL SNAPSHOT
     * These fields store calculated values at the time of booking.
     * They ensure that future settings changes do not affect past transactions.
     */
    
    // The original price set by the owner
    basePrice: {
      type: Number,
    },
    // Fixed platform adjustment based on room type
    platformAdjustment: {
      type: Number,
    },
    // basePrice + platformAdjustment (visible to student)
    displayPrice: {
      type: Number,
    },
    // Legacy room price field
    roomPrice: {
      type: Number,
    },
    // % Commission charged to owner
    commissionPercent: {
      type: Number,
    },
    // % Service fee charged to student
    serviceFeePercent: {
      type: Number,
    },
    // Calculated commission amount (basePrice * commissionPercent)
    commissionAmount: {
      type: Number,
    },
    // Calculated service fee amount (displayPrice * serviceFeePercent)
    serviceFeeAmount: {
      type: Number,
    },
    // Final amount payable to owner (basePrice - commissionAmount)
    ownerPayoutAmount: {
      type: Number,
    },
    // Legacy service fee field
    bookingFee: {
      type: Number,
    },
    // Legacy commission rate field
    commissionRate: {
      type: Number,
    },
    // Legacy commission amount field
    adminCommission: {
      type: Number,
    },
    // Transaction fee charged by Paystack
    paystackFee: {
      type: Number,
    },
    // commissionAmount + serviceFeeAmount + platformAdjustment
    platformGrossRevenue: {
      type: Number,
    },
    // platformGrossRevenue - paystackFee
    platformNetProfit: {
      type: Number,
    },
    // Duplicate of net profit for reporting
    platformNetRevenue: {
      type: Number,
    },
    // 2% of platformNetProfit reserved for taxes
    taxReserve: {
      type: Number,
    },
    // Final profit after all deductions and reserves
    platformFinalRetainedProfit: {
      type: Number,
    },
    // Recorded if Paystack fees exceed platform revenue
    platformLoss: {
      type: Number,
      default: 0,
    },
    // Legacy owner amount field
    ownerAmount: {
      type: Number,
    },
    // Total amount successfully collected
    totalPaid: {
      type: Number,
    },

    // Planned check-in date
    checkInDate: {
      type: Date,
      required: true,
    },

    /**
     * PAYMENT GATEWAY INTEGRATION (PAYSTACK)
     */
    paymentReference: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
      unique: true,
    },
    paymentMethod: {
      type: String,
      trim: true,
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    paymentDate: {
      type: Date,
    },
    paymentProvider: {
      type: String,
      enum: ['paystack'],
      default: 'paystack',
    },
    currency: {
      type: String,
      default: 'GHS',
    },
    paystackAccessCode: {
      type: String,
      trim: true,
    },
    paystackAuthorizationUrl: {
      type: String,
      trim: true,
    },
    paystackTransactionId: {
      type: Number,
    },
    paystackEventId: {
      type: String,
      unique: true,
      sparse: true,
    },
    paystackPaidAt: {
      type: Date,
    },
    gatewayResponse: {
      type: String,
    },
    paymentVerifiedAt: {
      type: Date,
    },

    /**
     * OWNER PAYOUT SETTLEMENT TRACKING
     */
    ownerPayoutStatus: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
    },
    ownerPayoutDate: {
      type: Date,
    },
    ownerPayoutReference: {
      type: String,
      trim: true,
    },
    payoutAttempts: {
      type: Number,
      default: 0,
    },
    lastPayoutAttempt: {
      type: Date,
    },
    payoutFailureReason: {
      type: String,
      trim: true,
    },
    // Flags the booking as ready for the payout queue
    payoutEligible: {
      type: Boolean,
      default: false,
    },
    // Tracks if room bed was released back to availability
    bedRestored: {
      type: Boolean,
      default: false,
    },
    // Prevent duplicate notifications
    notificationSent: {
      type: Boolean,
      default: false,
    },

    // Expiration timestamp for pending reservations
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ANALYTICS & PERFORMANCE INDEXES
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ bookingCode: 1 }, { unique: true, sparse: true });
bookingSchema.index({ paymentStatus: 1, bookingStatus: 1 });
bookingSchema.index({ hostel: 1, createdAt: -1 });
bookingSchema.index({ student: 1, createdAt: -1 });
bookingSchema.index({ student: 1, room: 1, bookingStatus: 1, paymentStatus: 1 });
bookingSchema.index({ hostel: 1, paymentStatus: 1, createdAt: -1 });
bookingSchema.index({ student: 1, bookingStatus: 1 });
bookingSchema.index({ paymentStatus: 1, ownerPayoutStatus: 1 });

/**
 * REFERENTIAL INTEGRITY VALIDATION
 * Ensures that referenced entities actually exist before saving.
 */
bookingSchema.pre('save', async function() {
  if (this.isNew || this.isModified('student') || this.isModified('room') || this.isModified('hostel')) {
    const [studentExists, roomExists, hostelExists] = await Promise.all([
      mongoose.model('User').exists({ _id: this.student }),
      mongoose.model('Room').exists({ _id: this.room }),
      mongoose.model('Hostel').exists({ _id: this.hostel })
    ]);

    if (!studentExists) throw new Error(`Referential Integrity Error: Student with ID ${this.student} does not exist.`);
    if (!roomExists) throw new Error(`Referential Integrity Error: Room with ID ${this.room} does not exist.`);
    if (!hostelExists) throw new Error(`Referential Integrity Error: Hostel with ID ${this.hostel} does not exist.`);
  }
});

module.exports = mongoose.model(
  'Booking',
  bookingSchema
);