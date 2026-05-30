const socketManager = require('../utils/socketManager');
const axios = require('axios');
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');

const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const User = require('../models/User');
const TransactionLedger = require('../models/TransactionLedger');
const PayoutQueue = require('../models/PayoutQueue');
const PayoutMethod = require('../models/PayoutMethod');
const sendEmail = require('../utils/sendEmail');
const {
  expireBookingReservation,
  logLifecycleEvent,
  restoreRoomBed,
  validateFinancialSnapshot,
} = require('../utils/bookingLifecycle');

const {
  createNotification,
  createNotifications,
} = require('../services/notificationService');

const {
  determineEntrySide,
  validateJournalGroupBalance,
} = require('../utils/accounting');

const { sendSuccess, sendError } = require('../utils/responseHandler');

const PAYSTACK_BASE_URL =
  'https://api.paystack.co';

const getPaystackSecret =
  () => {
    if (
      !process.env
        .PAYSTACK_SECRET_KEY
    ) {
      throw new Error(
        'Paystack secret key is not configured'
      );
    }

    return process.env
      .PAYSTACK_SECRET_KEY;
  };

const getFrontendUrl =
  () => {
    if (
      !process.env.FRONTEND_URL
    ) {
      throw new Error(
        'Frontend URL is not configured'
      );
    }

    return process.env
      .FRONTEND_URL;
  };

const toPaystackAmount =
  (amount) =>
    Math.round(
      Number(amount) * 100
    );

const buildReference =
  (bookingId) =>
    `hh-${bookingId}-${Date.now()}-${crypto
      .randomBytes(6)
      .toString('hex')}`;

const getPaystackHeaders =
  () => ({
    Authorization: `Bearer ${getPaystackSecret()}`,
    'Content-Type':
      'application/json',
  });

/* ------------------------------------------------ */
/* PAYMENT STATUS */
/* ------------------------------------------------ */

const mapPaystackStatus =
  (status) => {
    if (
      status === 'abandoned'
    ) {
      return 'abandoned';
    }

    if (
      status === 'failed'
    ) {
      return 'failed';
    }

    return 'pending';
  };

const recordUnsuccessfulPayment =
  async (paymentData) => {
    const bookingId =
      paymentData?.metadata
        ?.bookingId;

    const reference =
      paymentData?.reference;

    if (
      !bookingId &&
      !reference
    ) {
      return null;
    }

    const booking =
      await Booking.findOne({
        $or: [
          bookingId
            ? {
                _id: bookingId,
              }
            : null,
          reference
            ? {
                paymentReference:
                  reference,
              }
            : null,
        ].filter(Boolean),
      });

    if (
      !booking ||
      booking.paymentStatus ===
        'paid'
    ) {
      return booking;
    }

    const nextStatus =
      mapPaystackStatus(
        paymentData.status
      );

    booking.paymentStatus =
      nextStatus;

    booking.paymentReference =
      reference ||
      booking.paymentReference;

    booking.paymentMethod =
      paymentData.channel ||
      booking.paymentMethod;

    booking.paystackTransactionId =
      paymentData.id ||
      booking.paystackTransactionId;

    booking.paymentVerifiedAt =
      new Date();

    if (
      [
        'failed',
        'abandoned',
      ].includes(nextStatus)
    ) {
      booking.bookingStatus = 'cancelled';
      await booking.save();
      await restoreRoomBed(
        booking._id,
        `payment_${nextStatus}`
      );
    } else {
      await booking.save();
    }

    logLifecycleEvent('payment_unsuccessful_recorded', {
      bookingId: booking._id.toString(),
      roomId: booking.room.toString(),
      hostelId: booking.hostel.toString(),
      studentId: booking.student.toString(),
      paymentStatus: nextStatus,
      reference,
    });

    if (
      [
        'failed',
        'abandoned',
      ].includes(nextStatus)
    ) {
      await createNotification({
        user: booking.student,
        title:
          'Payment unsuccessful',
        message:
          'Your payment was not successful and the reserved bed was released.',
        type: 'payment',
        data: {
          booking: booking._id,
          reference,
          status: nextStatus,
        },
      });
    }

    return booking;
  };

/* ------------------------------------------------ */
/* APPLY SUCCESSFUL PAYMENT (DB UPDATE) */
/* ------------------------------------------------ */

const applySuccessfulPayment = async (booking, paymentData, eventId) => {
  // IDEMPOTENCY CHECK
  if (booking.paymentStatus === 'paid') {
    return booking;
  }

  // EVENT ID CHECK (PREVENT DUPLICATE WEBHOOK PROCESSING)
  if (eventId && booking.paystackEventId === eventId) {
    return booking;
  }

  // UPDATE BOOKING STATUS
  booking.paymentStatus = 'paid';
  booking.bookingStatus = 'approved';

  booking.amountPaid = Number(paymentData.amount) / 100;
  booking.paymentDate = paymentData.paid_at ? new Date(paymentData.paid_at) : new Date();

  booking.paystackTransactionId = paymentData.id;
  booking.paystackEventId = eventId || booking.paystackEventId;
  booking.paystackPaidAt = paymentData.paid_at ? new Date(paymentData.paid_at) : new Date();
  booking.gatewayResponse = paymentData.gateway_response || 'Successful';
  booking.paymentMethod = paymentData.channel || 'paystack';
  booking.paymentVerifiedAt = new Date();

  // STEP 2 — VERIFY SNAPSHOT PERSISTENCE
  // Ensure we persist all financial fields
  booking.basePrice = Number(booking.basePrice) || 0;
  booking.platformAdjustment = Number(booking.platformAdjustment) || 0;
  booking.displayPrice = Number(booking.displayPrice) || 0;
  booking.roomPrice = Number(booking.roomPrice) || 0;
  booking.commissionPercent = Number(booking.commissionPercent) || 0;
  booking.serviceFeePercent = Number(booking.serviceFeePercent) || 0;
  booking.commissionAmount = Number(booking.commissionAmount) || 0;
  booking.serviceFeeAmount = Number(booking.serviceFeeAmount) || 0;
  booking.ownerPayoutAmount = Number(booking.ownerPayoutAmount) || 0;
  
  booking.bookingFee = Number(booking.bookingFee) || 0;
  booking.adminCommission = Number(booking.adminCommission) || 0;
  booking.ownerAmount = Number(booking.ownerAmount) || 0;
  booking.paystackFee = Number(booking.paystackFee) || 0;
  booking.platformNetProfit = Number(booking.platformNetProfit) || 0;
  booking.taxReserve = Number(booking.taxReserve) || 0;
  booking.platformFinalRetainedProfit = Number(booking.platformFinalRetainedProfit) || 0;
  booking.totalPaid = Number(booking.totalPaid) || 0;

  booking.payoutEligible = true;

  await booking.save();

  logLifecycleEvent('payment_verified', {
    bookingId: booking._id.toString(),
    roomId: booking.room.toString(),
    hostelId: booking.hostel.toString(),
    studentId: booking.student.toString(),
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    reference: booking.paymentReference,
    transactionId: booking.paystackTransactionId,
    amountPaid: booking.amountPaid,
  });

  return booking;
};

/* ------------------------------------------------ */
/* FINALIZE PAYMENT (ACCOUNTING & NOTIFICATIONS) */
/* ------------------------------------------------ */

const finalizePayment = async (paymentData, eventId, io) => {
  const reference = paymentData.reference;

  // Find booking by reference
  const booking = await Booking.findOne({ paymentReference: reference });

  if (!booking) {
    throw new Error(`Booking with reference ${reference} not found`);
  }

  // STEP 1 — TRACE finalizePayment
  console.log('FINALIZE PAYMENT BOOKING:', booking);

  console.log('FINANCIAL SNAPSHOT:', {
    roomPrice: booking.roomPrice,
    bookingFee: booking.bookingFee,
    adminCommission: booking.adminCommission,
    ownerAmount: booking.ownerAmount,
    paystackFee: booking.paystackFee,
    totalPaid: booking.totalPaid
  });

  if (
    booking.paymentStatus !== 'paid' &&
    (booking.bookingStatus !== 'pending' || booking.paymentStatus !== 'pending')
  ) {
    throw new Error(
      `Booking ${booking._id} is not payable in its current lifecycle state`
    );
  }

  if (
    booking.paymentStatus !== 'paid' &&
    booking.expiresAt &&
    new Date() > new Date(booking.expiresAt)
  ) {
    await expireBookingReservation(booking._id);
    throw new Error(`Booking ${booking._id} reservation has expired`);
  }

  validateFinancialSnapshot(booking);

  // VALIDATE AMOUNT (USE FROZEN SNAPSHOT)
  const expectedAmount = toPaystackAmount(booking.totalPaid || booking.amount);
  if (Number(paymentData.amount) !== expectedAmount) {
    throw new Error(`Payment amount mismatch. Expected ${expectedAmount}, got ${paymentData.amount}`);
  }

  // VALIDATE CURRENCY
  if (paymentData.currency !== booking.currency) {
    throw new Error(`Currency mismatch. Expected ${booking.currency}, got ${paymentData.currency}`);
  }

  // 1. CHECK IF WE'VE ALREADY RECORDED LEDGER ENTRIES
  // We check if a ledger entry already exists for this booking and reference
  const existingLedger = await TransactionLedger.findOne({
    booking: booking._id,
    reference: reference,
    type: 'payment' 
  });

  if (existingLedger) {
    console.log('DEBUG: Ledger entry already exists for reference:', reference);
    return applySuccessfulPayment(booking, paymentData, eventId);
  }

  // 2. APPLY PAYMENT STATUS AFTER PAYSTACK DATA MATCHES THE FROZEN SNAPSHOT
  const updatedBooking = await applySuccessfulPayment(booking, paymentData, eventId);
  
  // RE-FETCH TO ENSURE WE HAVE LATEST SNAPSHOT WITH FULL DETAILS FOR NOTIFICATIONS
  const finalBooking = await Booking.findById(updatedBooking._id)
    .populate('student', 'name email')
    .populate('hostel', 'name owner')
    .populate('room', 'roomType occupancyStyle');

  if (!finalBooking) {
    throw new Error('Critical Error: Booking lost after save');
  }

  // GENERATE JOURNAL GROUP FOR THE ENTIRE PAYMENT EVENT
  const journalGroup = `jg-pay-${finalBooking._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const owner = await User.findById(finalBooking.hostel.owner).select('name email');
  const PayoutMethod = require('../models/PayoutMethod');
  const payoutMethod = await PayoutMethod.findOne({ owner: finalBooking.hostel.owner });
  
  // CREATE LEDGER ENTRIES (ACCOUNTING SOURCE OF TRUTH)
  const ledgerEntries = [
    {
      booking: finalBooking._id,
      type: 'payment',
      accountCategory: 'asset',
      amount: finalBooking.totalPaid - finalBooking.paystackFee,
      direction: 'debit',
      entrySide: 'debit',
      journalGroup,
      status: 'success',
      reference: reference,
      provider: 'paystack',
      metadata: { info: 'Actual cash received via Paystack' },
    },
    {
      booking: finalBooking._id,
      type: 'paystack_fee',
      accountCategory: 'expense',
      amount: finalBooking.paystackFee,
      direction: 'debit',
      entrySide: 'debit',
      journalGroup,
      status: 'success',
      reference: reference,
      metadata: { info: 'Paystack processing fee' },
    },
    {
      booking: finalBooking._id,
      type: 'service_fee',
      accountCategory: 'revenue',
      amount: finalBooking.serviceFeeAmount || finalBooking.bookingFee,
      direction: 'credit',
      entrySide: 'credit',
      journalGroup,
      status: 'success',
      reference: reference,
      provider: 'paystack',
      metadata: { info: 'Platform service fee' },
    },
    {
      booking: finalBooking._id,
      type: 'platform_adjustment',
      accountCategory: 'revenue',
      amount: finalBooking.platformAdjustment || 0,
      direction: 'credit',
      entrySide: 'credit',
      journalGroup,
      status: 'success',
      reference: reference,
      provider: 'paystack',
      metadata: { info: 'Global room price adjustment' },
    },
    {
      booking: finalBooking._id,
      type: 'platform_commission',
      accountCategory: 'revenue',
      amount: finalBooking.commissionAmount || finalBooking.adminCommission,
      direction: 'credit',
      entrySide: 'credit',
      journalGroup,
      status: 'success',
      reference: reference,
      metadata: { info: 'Full platform commission (Gross)' },
    },
    {
      booking: finalBooking._id,
      type: 'tax_reserve',
      accountCategory: 'liability',
      amount: finalBooking.taxReserve,
      direction: 'credit',
      entrySide: 'credit',
      journalGroup,
      status: 'success',
      reference: reference,
      metadata: { info: 'Tax obligation (2% of net profit)' },
    },
    {
      booking: finalBooking._id,
      type: 'adjustment',
      accountCategory: 'reserve',
      amount: finalBooking.taxReserve,
      direction: 'debit',
      entrySide: 'debit',
      journalGroup,
      status: 'success',
      reference: reference,
      metadata: { info: 'Internal allocation for tax reserve' },
    },
    {
      booking: finalBooking._id,
      type: 'owner_payout',
      accountCategory: 'liability',
      amount: finalBooking.ownerPayoutAmount || finalBooking.ownerAmount,
      direction: 'credit',
      entrySide: 'credit',
      journalGroup,
      status: 'success',
      reference: reference,
      metadata: { info: 'Allocation to owner (Liability)' },
    },
  ];

  await TransactionLedger.insertMany(ledgerEntries);

  // STEP 3 — TRACE PAYOUT QUEUE CREATION
  console.log('PAYOUT QUEUE DATA:', {
    amount: finalBooking.ownerAmount,
    commissionAmount: finalBooking.adminCommission,
    paystackFee: finalBooking.paystackFee,
    finalTransferAmount: finalBooking.ownerAmount // OWNER RECEIVES FULL AMOUNT
  });

  // STEP 4 — FIX ROOT CAUSE
  const safeAmount = Number(finalBooking.ownerAmount);
  const safeCommission = Number(finalBooking.adminCommission);
  const safePaystackFee = Number(finalBooking.paystackFee);
  const safeFinalTransfer = safeAmount; // NO DOUBLE DEDUCTION

  if (isNaN(safeAmount) || isNaN(safeCommission) || isNaN(safePaystackFee) || isNaN(safeFinalTransfer)) {
    throw new Error('Financial values corrupted during finalization: NaN detected');
  }

  if (safeFinalTransfer <= 0) {
    throw new Error(`Invalid final transfer amount: ${safeFinalTransfer}. Cannot create payout queue.`);
  }

  const payoutQueueData = {
    booking: finalBooking._id,
    owner: finalBooking.hostel.owner,
    hostel: finalBooking.hostel._id,
    payoutMethod: payoutMethod?._id,
    grossAmount: safeAmount,
    platformFee: safeCommission,
    netAmount: safeFinalTransfer,
    amount: safeAmount,
    commissionAmount: safeCommission,
    paystackFee: safePaystackFee,
    finalTransferAmount: safeFinalTransfer,
    recipientCode: payoutMethod?.recipientCode,
    currency: finalBooking.currency || 'GHS',
    status: 'pending',
    metadata: {
      studentId: finalBooking.student._id,
      reference,
      journalGroup,
      taxReserve: finalBooking.taxReserve
    }
  };

  // CREATE PAYOUT QUEUE ENTRY
  await PayoutQueue.create(payoutQueueData);

  // JOURNAL VALIDATION (OBSERVABILITY ONLY)
  const balanceResult = validateJournalGroupBalance(ledgerEntries);
  if (!balanceResult.balanced) {
    console.warn(`[JOURNAL IMBALANCE] Journal Group: ${journalGroup}. Difference: ${balanceResult.difference}. Debits: ${balanceResult.debitTotal}, Credits: ${balanceResult.creditTotal}`);
  }

  // STEP 5 — DISPATCH NOTIFICATIONS (IDEMPOTENT)
  if (!finalBooking.notificationSent) {
    try {
      const bookingDate = new Date(finalBooking.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      // 1. DISPATCH IN-APP NOTIFICATIONS
      await createNotifications([
        {
          user: finalBooking.student._id,
          title: 'Booking Confirmed!',
          message: `Your booking at ${finalBooking.hostel.name} is confirmed. Booking Code: ${finalBooking.bookingCode}`,
          type: 'payment',
          data: {
            booking: finalBooking._id,
            reference,
            redirect: `/student/bookings?id=${finalBooking._id}`
          },
        },
        {
          user: finalBooking.hostel.owner,
          title: 'New Booking Received',
          message: `NEW BOOKING\nStudent: ${finalBooking.student.name}\n\nBOOKING CODE\n${finalBooking.bookingCode}`,
          type: 'booking',
          data: {
            booking: finalBooking._id,
            hostel: finalBooking.hostel._id,
            reference,
            redirect: `/owner/bookings?id=${finalBooking._id}`
          },
        },
      ]);

      // 2. SEND EMAIL NOTIFICATION TO OWNER
      if (owner && owner.email) {
        const ownerEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #2563eb; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">New Booking Received</h2>
              <p style="font-size: 16px;">Hello <strong>${owner.name}</strong>,</p>
              <p style="font-size: 16px;">Great news! A student has successfully booked a room in your hostel through the Relaxly platform.</p>
              
              <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #f1f5f9; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px;">Booking Summary</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Student</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${finalBooking.student.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Booking Code</td>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 14px; font-weight: 700; text-align: right; font-family: monospace;">${finalBooking.bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Hostel</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${finalBooking.hostel.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Room Type</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${finalBooking.room.occupancyStyle}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Amount Paid</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">GHS ${finalBooking.totalPaid.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Booking Date</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${bookingDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0 0 0; color: #64748b; font-size: 14px;">Status</td>
                    <td style="padding: 12px 0 0 0; text-align: right;">
                      <span style="background-color: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase;">Payment Verified</span>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin-top: 35px;">
                <a href="${process.env.FRONTEND_URL}/owner/bookings" style="background-color: #2563eb; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Manage Booking</a>
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Thank you for partnering with Relaxly.</p>
              <p style="margin: 8px 0 0 0; font-size: 14px; font-weight: 700; color: #475569;">Making Student Accommodation Simple.</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        await sendEmail({
          email: owner.email,
          subject: 'New Booking Received • Relaxly',
          message: ownerEmailMessage
        });
      }

      // 3. SEND EMAIL NOTIFICATION TO STUDENT
      if (finalBooking.student && finalBooking.student.email) {
        const studentEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #2563eb; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Booking Confirmed!</h2>
              <p style="font-size: 16px;">Hello <strong>${finalBooking.student.name}</strong>,</p>
              <p style="font-size: 16px;">Your payment has been successfully verified. Your room at <strong>${finalBooking.hostel.name}</strong> is now reserved and confirmed.</p>
              
              <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #f1f5f9; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px;">Reservation Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Booking Code</td>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 16px; font-weight: 800; text-align: right; font-family: monospace;">${finalBooking.bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Hostel</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${finalBooking.hostel.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Room Type</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${finalBooking.room.occupancyStyle}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Amount Paid</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">GHS ${finalBooking.totalPaid.toLocaleString()}</td>
                  </tr>
                </table>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px dashed #e2e8f0; text-align: center;">
                  <p style="font-size: 14px; color: #ef4444; font-weight: 700; margin: 0;">IMPORTANT: Please present the Booking Code above during check-in.</p>
                </div>
              </div>
              
              <div style="text-align: center; margin-top: 35px;">
                <a href="${process.env.FRONTEND_URL}/student/bookings" style="background-color: #2563eb; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">View Booking Status</a>
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Welcome to the Relaxly community!</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        await sendEmail({
          email: finalBooking.student.email,
          subject: 'Booking Confirmed • Relaxly',
          message: studentEmailMessage
        });
      }

      // 4. NOTIFY ADMINS
      const admins = await User.find({
        role: { $in: ['super_admin', 'finance_admin', 'support_admin', 'verification_admin', 'admin', 'moderator'] },
        accountStatus: 'active'
      }).select('name email');

      if (admins.length > 0) {
        // AUDIT: Ensure safe fallbacks for all financial fields (Legacy support)
        const totalPaid = finalBooking.totalPaid || finalBooking.amount || 0;
        const basePrice = finalBooking.basePrice || finalBooking.roomPrice || 0;
        const platformAdj = finalBooking.platformAdjustment || 0;
        const serviceFee = finalBooking.serviceFeeAmount || finalBooking.bookingFee || 0;
        const ownerShare = finalBooking.ownerPayoutAmount || finalBooking.ownerAmount || 0;
        
        // CANONICAL CALCULATION: Platform Share = Total Paid - Owner Share
        // This ensures all platform revenue (Adj + Comm + Fee) is captured correctly.
        const platformShare = finalBooking.platformGrossRevenue || Math.max(0, totalPaid - ownerShare);

        // Build in-app notifications for all admins
        const adminNotifications = admins.map(admin => ({
          user: admin._id,
          title: 'Finance Alert: New Payment',
          message: `Student: ${finalBooking.student.name}\nBOOKING: ${finalBooking.bookingCode}\n\nDISTRIBUTION:\nTotal Paid: GHS ${totalPaid.toLocaleString()}\nOwner Receives: GHS ${ownerShare.toLocaleString()}\nPlatform Share: GHS ${platformShare.toLocaleString()}\n\nBREAKDOWN:\nRoom: GHS ${basePrice.toLocaleString()}\nAdj: GHS ${platformAdj.toLocaleString()}\nFee: GHS ${serviceFee.toLocaleString()}`,
          type: 'finance',
          data: {
            booking: finalBooking._id,
            reference,
            amount: totalPaid,
            hostel: finalBooking.hostel._id,
            student: finalBooking.student._id,
            redirect: `/bookings?id=${finalBooking._id}`
          },
        }));

        await createNotifications(adminNotifications);

        // Build email message for admins
        const adminEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #0f172a; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly Finance</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Finance Alert: New Payment</h2>
              <p style="font-size: 16px;">A student has successfully completed payment for a booking. Financial distribution and breakdown are provided below.</p>
              
              <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #f1f5f9; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px;">Revenue Distribution</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                  <tr>
                    <td style="padding: 10px 0; color: #0f172a; font-size: 16px; font-weight: 700;">Total Paid by Student</td>
                    <td style="padding: 10px 0; color: #0f172a; font-size: 16px; font-weight: 800; text-align: right;">GHS ${totalPaid.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #059669; font-size: 14px; font-weight: 600;">Owner Share (Payout)</td>
                    <td style="padding: 8px 0; color: #059669; font-size: 14px; font-weight: 700; text-align: right;">GHS ${ownerShare.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 14px; font-weight: 600;">Platform Share (Gross)</td>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 14px; font-weight: 700; text-align: right;">GHS ${platformShare.toLocaleString()}</td>
                  </tr>
                </table>

                <h3 style="margin-top: 20px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px; border-top: 1px dashed #e2e8f0; padding-top: 20px;">Calculation Breakdown</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Base Room Price</td>
                    <td style="padding: 6px 0; color: #0f172a; font-size: 13px; font-weight: 600; text-align: right;">GHS ${basePrice.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Platform Adjustment</td>
                    <td style="padding: 6px 0; color: #0f172a; font-size: 13px; font-weight: 600; text-align: right;">GHS ${platformAdj.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Student Service Fee</td>
                    <td style="padding: 6px 0; color: #0f172a; font-size: 13px; font-weight: 600; text-align: right;">GHS ${serviceFee.toLocaleString()}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9;">
                <h3 style="margin-top: 0; font-size: 12px; text-transform: uppercase; color: #94a3b8; margin-bottom: 10px;">Reference Info</h3>
                <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Student:</strong> ${finalBooking.student.name}</p>
                <p style="margin: 4px 0; font-size: 13px; color: #64748b;"><strong>Booking Code:</strong> <span style="font-family: monospace;">${finalBooking.bookingCode}</span></p>
                <p style="margin: 4px 0; font-size: 13px; color: #64748b;"><strong>Hostel:</strong> ${finalBooking.hostel.name}</p>
                <p style="margin: 4px 0; font-size: 13px; color: #64748b;"><strong>Reference:</strong> <span style="font-family: monospace;">${reference}</span></p>
              </div>
              
              <div style="text-align: center; margin-top: 35px;">
                <a href="${process.env.FRONTEND_URL}/bookings?id=${finalBooking._id}" style="background-color: #0f172a; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">View in Management Center</a>
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Relaxly Finance Audit Notification</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        // Send individual emails to each admin
        const emailPromises = admins.map(admin => 
          sendEmail({
            email: admin.email,
            subject: 'New Student Payment • Relaxly',
            message: adminEmailMessage
          }).catch(err => console.error(`[ADMIN_EMAIL_FAILURE] To: ${admin.email} - ${err.message}`))
        );
        
        await Promise.all(emailPromises);

        // 5. AUDIT LOG
        const AdminAuditLog = require('../models/AdminAuditLog');
        await AdminAuditLog.create({
          admin: null, // System-generated
          adminModel: 'Admin',
          actionType: 'ADMIN_PAYMENT_NOTIFICATION_SENT',
          targetType: 'Booking',
          targetId: finalBooking._id,
          severity: 'low',
          status: 'success',
          metadata: {
            bookingId: finalBooking._id,
            studentId: finalBooking.student._id,
            amount: finalBooking.totalPaid,
            reference,
            timestamp: new Date()
          }
        });
      }

      // MARK AS SENT
      await Booking.findByIdAndUpdate(finalBooking._id, { notificationSent: true });

    } catch (notificationError) {
      console.error('[NOTIFICATION FAILURE] Payment verified but notifications failed:', notificationError.message);
    }
  }

  // SOCKET UPDATE
  if (io) {
    io.to(finalBooking.student._id.toString()).emit('payment_update', {
      bookingId: finalBooking._id,
      status: 'paid',
      paymentStatus: 'paid',
    });
  }

  return finalBooking;
};

/* ------------------------------------------------ */
/* INITIALIZE PAYMENT */
/* ------------------------------------------------ */

const initializePayment =
  asyncHandler(
    async (req, res) => {
      console.log('INITIALIZE PAYMENT REQUEST:', JSON.stringify(req.body, null, 2));
      
      // Support multiple field names from frontend
      const bookingId = req.body.bookingId || req.body.booking_id || req.body.id || req.body._id;

      if (!bookingId) {
        res.status(400);

        throw new Error(
          'Booking ID is required (use "bookingId" or "id")'
        );
      }

      const booking =
        await Booking.findById(
          bookingId
        )
          .populate(
            'student',
            'name email phone'
          )
          .populate(
            'room',
            'roomType price'
          )
          .populate(
            'hostel',
            'name location'
          );

      if (!booking) {
        res.status(404);

        throw new Error(
          'Booking not found'
        );
      }

      if (
        booking.student._id.toString() !==
        req.user.id
      ) {
        res.status(403);

        throw new Error(
          'Not authorized to pay for this booking'
        );
      }

      const reference =
        buildReference(
          booking._id.toString()
        );

      if (booking.bookingStatus !== 'pending' || booking.paymentStatus !== 'pending') {
        console.warn(`[PAYMENT_INIT_BLOCKED] Booking ${booking._id} status is ${booking.bookingStatus}/${booking.paymentStatus}`);
        res.status(400);
        throw new Error(`Booking is not in a valid state for payment (Status: ${booking.bookingStatus}, Payment: ${booking.paymentStatus})`);
      }

      if (booking.expiresAt && new Date() > new Date(booking.expiresAt)) {
        await expireBookingReservation(booking._id);
        res.status(400);
        throw new Error('Booking reservation has expired. Please start a new booking.');
      }

      try {
        validateFinancialSnapshot(booking);
      } catch (error) {
        console.error('[FINANCIAL_SNAPSHOT_INVALID]', error.message, error.missingFields);
        res.status(error.statusCode || 400);
        throw error;
      }

      if (booking.paymentReference) {
        if (!booking.paystackAccessCode || !booking.paystackAuthorizationUrl) {
          console.warn(`[PAYMENT_INIT_INCOMPLETE] Booking ${booking._id} has reference but no checkout details`);
          res.status(409);
          throw new Error(
            'Payment was initialized previously but checkout details are incomplete. Contact support.'
          );
        }

        logLifecycleEvent('payment_initialization_reused', {
          bookingId: booking._id.toString(),
          roomId: booking.room._id.toString(),
          hostelId: booking.hostel._id.toString(),
          studentId: booking.student._id.toString(),
          reference: booking.paymentReference,
        });

        return sendSuccess(res, {
          authorization_url: booking.paystackAuthorizationUrl,
          access_code: booking.paystackAccessCode,
          reference: booking.paymentReference,
          roomPrice: booking.roomPrice,
          bookingFee: booking.bookingFee,
          totalPaid: booking.totalPaid,
        }, 'Payment previously initialized');
      }

      const amount =
        toPaystackAmount(
          booking.totalPaid || booking.amount // Use frozen snapshot
        );

      if (isNaN(amount) || amount <= 0) {
        console.error(`[INVALID_PAYMENT_AMOUNT] Booking ${booking._id} totalPaid=${booking.totalPaid} amount=${booking.amount}`);
        return sendError(res, 'Invalid payment amount. Calculation failed or amount is zero.', 400);
      }

      let response;
      try {
        const paystackPayload = {
          email:
            booking.student
              .email,
          amount,
          reference,
          currency: booking.currency || 'GHS',
          callback_url:
            req.body.callback_url ||
            `${
              process.env.CLIENT_URL ||
              getFrontendUrl()
            }/payments/verify`,
          metadata: {
            bookingId:
              booking._id.toString(),
          },
        };

        console.log('DEBUG: Initializing Paystack transaction:', JSON.stringify(paystackPayload, null, 2));
        
        response = await axios.post(
          `${PAYSTACK_BASE_URL}/transaction/initialize`,
          paystackPayload,
          {
            headers:
              getPaystackHeaders(),
          }
        );
        console.log('DEBUG: Paystack initialization successful');
      } catch (error) {
        console.error('DEBUG: Paystack initialization error:', error.response?.data || error.message);
        return sendError(res, (error.response?.data?.message || 'Payment initialization failed at Paystack gateway') + ' (Reference: ' + reference + ')', 400);
      }

      booking.paymentReference =
        reference;

      booking.paystackAccessCode =
        response.data.data
          .access_code;

      booking.paystackAuthorizationUrl =
        response.data.data
          .authorization_url;

      booking.paymentStatus =
        'pending';

      await booking.save();

      logLifecycleEvent('payment_initialized', {
        bookingId: booking._id.toString(),
        roomId: booking.room._id.toString(),
        hostelId: booking.hostel._id.toString(),
        studentId: booking.student._id.toString(),
        reference,
        amount,
        currency: booking.currency,
      });

      res.status(200).json({
        success: true,
        message: 'Payment initialized successfully',
        authorization_url:
          response.data.data
            .authorization_url,
        access_code:
          response.data.data
            .access_code,
        reference,
        // RETURN ONLY PUBLIC FACING AMOUNTS
        roomPrice: booking.roomPrice,
        bookingFee: booking.bookingFee,
        totalPaid: booking.totalPaid,
        data: {
          authorization_url:
            response.data.data
              .authorization_url,
          access_code:
            response.data.data
              .access_code,
          reference,
          roomPrice: booking.roomPrice,
          bookingFee: booking.bookingFee,
          totalPaid: booking.totalPaid,
        }
      });
    }
  );

/* ------------------------------------------------ */
/* VERIFY PAYMENT (STATUS CHECK ONLY) */
/* ------------------------------------------------ */

const verifyPayment =
  asyncHandler(
    async (req, res) => {
      const { reference } =
        req.params;

      if (!reference) {
        return sendError(res, 'Payment reference required', 400);
      }

      // We check our DB first to see if the webhook already processed it
      const booking = await Booking.findOne({ paymentReference: reference });

      if (!booking) {
        return sendError(res, 'Booking not found', 404);
      }

      if (
        req.user.role === 'student' &&
        booking.student.toString() !== req.user.id
      ) {
        return sendError(res, 'Not authorized', 403);
      }

      // If already paid, return success immediately
      if (booking.paymentStatus === 'paid') {
        return res.status(200).json({
          success: true,
          message: 'Payment verified successfully',
          booking,
          data: booking
        });
      }

      // If not yet paid, we check Paystack status
      let response;
      try {
        response = await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
          {
            headers:
              getPaystackHeaders(),
            timeout: 15000,
          }
        );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.response?.data?.message || 'Payment verification failed at gateway'
        });
      }

      const paystackData =
        response.data.data;

      if (paystackData && paystackData.status === 'success') {
        // FALLBACK: Trigger finalization if webhook is slow
        const io = req.app.get('io');
        const updatedBooking = await finalizePayment(paystackData, null, io);

        return res.status(200).json({
          success: true,
          message: 'Payment verified and booking finalized',
          booking: updatedBooking,
          data: updatedBooking
        });
      }

      if (paystackData && ['failed', 'abandoned'].includes(paystackData.status)) {
        await recordUnsuccessfulPayment(paystackData);
      }

      logLifecycleEvent('payment_verification_pending', {
        bookingId: booking._id.toString(),
        roomId: booking.room.toString(),
        hostelId: booking.hostel.toString(),
        studentId: booking.student.toString(),
        reference,
        gatewayStatus: paystackData?.status,
      });

      return res.status(200).json({
        success: true,
        message: 'Payment not yet confirmed',
        booking,
        data: booking
      });
    }
  );

/* ------------------------------------------------ */
/* WEBHOOK (PRIMARY SOURCE OF TRUTH) */
/* ------------------------------------------------ */

const paystackWebhook =
  asyncHandler(
    async (req, res) => {
      const signature =
        req.headers[
          'x-paystack-signature'
        ];

      if (!signature) {
        return res
          .status(401)
          .json({
            message:
              'Missing Paystack signature',
          });
      }

      const hash = crypto
        .createHmac(
          'sha512',
          getPaystackSecret()
        )
        .update(req.body)
        .digest('hex');

      const isValidSignature =
        signature.length ===
          hash.length &&
        crypto.timingSafeEqual(
          Buffer.from(hash),
          Buffer.from(signature)
        );

      if (
        !isValidSignature
      ) {
        return res
          .status(401)
          .json({
            message:
              'Invalid signature',
          });
      }

      const event = JSON.parse(
        req.body.toString(
          'utf8'
        )
      );

      if (
        event.event ===
        'charge.success'
      ) {
        try {
          // ONLY webhook finalizes the payment
          const io = req.app.get('io');
          await finalizePayment(
            event.data,
            event.id, // Use event.id for idempotency
            io
          );
        } catch (error) {
          console.error(
            'Webhook processing failed:',
            error.message
          );
          // Still return 200 to Paystack so they stop retrying,
          // but we should log the error for manual investigation.
        }
      }

      res.sendStatus(200);
    }
  );

module.exports = {
  initializePayment,
  verifyPayment,
  paystackWebhook,
};
