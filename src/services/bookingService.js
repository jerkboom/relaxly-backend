const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const User = require('../models/User');
const TransactionLedger = require('../models/TransactionLedger');
const PayoutQueue = require('../models/PayoutQueue');
const PayoutMethod = require('../models/PayoutMethod');
const crypto = require('crypto');
const { 
  restoreRoomBed, 
  logLifecycleEvent, 
  validateFinancialSnapshot 
} = require('../utils/bookingLifecycle');
const { createNotifications } = require('./notificationService');
const sendEmail = require('../utils/sendEmail');
const { buildAdminUrl } = require('../utils/adminUrl');
const adminNotifier = require('../utils/adminNotifier');
const { runTransactionWithRetry } = require('../utils/transactionHelper');

/**
 * Approve a booking and notify the student.
 */
const approveBooking = async (bookingId, adminId, req) => {
  return await runTransactionWithRetry(async (session) => {
    const booking = await Booking.findById(bookingId)
      .session(session)
      .populate('student', 'name email')
      .populate('hostel', 'name location owner');

    if (!booking) throw new Error('Booking not found');

    booking.bookingStatus = 'approved';
    await booking.save({ session });

    logLifecycleEvent('admin_booking_approved', {
      bookingId: booking._id,
      adminId,
    });

    await createNotifications([
      {
        user: booking.student._id,
        title: 'Booking Approved',
        message: `Your booking at ${booking.hostel.name} has been approved.`,
        type: 'booking',
        data: { booking: booking._id },
      }
    ], session);

    // Sync ambassador commission status
    try {
      const ambassadorService = require('./ambassadorService');
      await ambassadorService.syncCommissionStatus(booking, session);
    } catch (err) {
      console.error('Failed to sync ambassador commission on approval:', err.message);
    }

    return booking;
  });
};

/**
 * Cancel a booking, restore inventory, and notify student/owner.
 */
const cancelBooking = async (bookingId, adminId, reason = 'admin_cancelled') => {
  return await runTransactionWithRetry(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw new Error('Booking not found');

    if (booking.bookingStatus === 'cancelled') {
      throw new Error('Booking is already cancelled');
    }

    booking.bookingStatus = 'cancelled';
    await booking.save({ session });

    // 1. Restore inventory
    await restoreRoomBed(booking._id, reason, session);

    // 1.5. Cancel pending payout queue entry
    await PayoutQueue.updateMany(
      { booking: bookingId, status: { $in: ['pending', 'failed', 'otp_failed'] } },
      { 
        $set: { 
          status: 'cancelled',
          failureReason: `Booking cancelled by admin: ${reason}`
        } 
      },
      { session }
    );

    // 1.7. Revoke ambassador commission
    try {
      const ambassadorService = require('./ambassadorService');
      await ambassadorService.handleBookingCancellation(booking._id, `Booking cancelled by admin: ${reason}`, session);
    } catch (err) {
      console.error('Failed to revoke ambassador commission:', err.message);
    }

    // 2. Lifecycle Log
    logLifecycleEvent('admin_booking_cancelled', {
      bookingId: booking._id,
      adminId,
      reason,
    });

    // 3. Notifications
    const student = await User.findById(booking.student).select('name email').session(session);
    const hostel = await Hostel.findById(booking.hostel).select('name owner').session(session);

    await createNotifications([
      {
        user: booking.student,
        title: 'Booking Cancelled',
        message: `Your booking at ${hostel.name} has been cancelled by an administrator.`,
        type: 'booking',
        data: { booking: booking._id },
      },
      {
        user: hostel.owner,
        title: 'Booking Cancelled',
        message: `A booking for your hostel ${hostel.name} was cancelled by an administrator.`,
        type: 'booking',
        data: { booking: booking._id },
      }
    ], session);

    return booking;
  });
};

/**
 * Manually mark a booking as paid, create ledger entries, and payout queue.
 */
const markBookingAsPaid = async (bookingId, adminId, paymentMethod = 'manual_admin') => {
  return await runTransactionWithRetry(async (session) => {
    const booking = await Booking.findById(bookingId)
      .session(session)
      .populate('student', 'name email')
      .populate('hostel', 'name owner location')
      .populate('room', 'roomType occupancyStyle');

    if (!booking) throw new Error('Booking not found');
    if (booking.paymentStatus === 'paid') return booking;

    validateFinancialSnapshot(booking);

    // 1. Update status
    booking.paymentStatus = 'paid';
    booking.bookingStatus = 'approved';
    booking.paymentMethod = paymentMethod;
    booking.paymentDate = new Date();
    booking.amountPaid = booking.totalPaid;
    booking.payoutEligible = true;
    await booking.save({ session });

    // 2. Generate Journal Group
    const journalGroup = `jg-admin-pay-${booking._id}-${Date.now()}`;
    const reference = booking.paymentReference || `admin-${booking._id}-${Date.now()}`;

    // 3. Create Ledger Entries
    const ledgerEntries = [
      {
        booking: booking._id,
        type: 'payment',
        accountCategory: 'asset',
        amount: booking.totalPaid, 
        direction: 'debit',
        entrySide: 'debit',
        journalGroup,
        status: 'success',
        reference,
        provider: 'manual',
        metadata: { info: 'Manual payment recorded by admin', adminId },
      },
      {
        booking: booking._id,
        type: 'owner_payout',
        accountCategory: 'liability',
        amount: booking.ownerAmount,
        direction: 'credit',
        entrySide: 'credit',
        journalGroup,
        status: 'success',
        reference,
        metadata: { info: 'Allocation to owner (Liability)' },
      },
      {
        booking: booking._id,
        type: 'platform_commission',
        accountCategory: 'revenue',
        amount: booking.commissionAmount,
        direction: 'credit',
        entrySide: 'credit',
        journalGroup,
        status: 'success',
        reference,
      },
      {
        booking: booking._id,
        type: 'service_fee',
        accountCategory: 'revenue',
        amount: booking.serviceFeeAmount,
        direction: 'credit',
        entrySide: 'credit',
        journalGroup,
        status: 'success',
        reference,
      },
      {
        booking: booking._id,
        type: 'platform_adjustment',
        accountCategory: 'revenue',
        amount: booking.platformAdjustment || 0,
        direction: 'credit',
        entrySide: 'credit',
        journalGroup,
        status: 'success',
        reference,
      },
      {
        booking: booking._id,
        type: 'tax_reserve',
        accountCategory: 'liability',
        amount: booking.taxReserve || 0,
        direction: 'credit',
        entrySide: 'credit',
        journalGroup,
        status: 'success',
        reference,
      }
    ];
    await TransactionLedger.insertMany(ledgerEntries, { session });

    // 4. Payout Queue Entry
    const payoutMethod = await PayoutMethod.findOne({ owner: booking.hostel.owner }).session(session);
    const [payout] = await PayoutQueue.create([{
      booking: booking._id,
      owner: booking.hostel.owner,
      hostel: booking.hostel._id,
      payoutMethod: payoutMethod?._id,
      transferMethod: payoutMethod?.type,
      provider: payoutMethod?.provider,
      bankName: payoutMethod?.bankName || payoutMethod?.provider,
      accountNumber: payoutMethod?.accountNumber,
      accountName: payoutMethod?.accountName,
      amount: booking.ownerAmount,
      commissionAmount: booking.adminCommission,
      paystackFee: 0,
      finalTransferAmount: booking.ownerAmount,
      recipientCode: payoutMethod?.recipientCode,
      currency: booking.currency || 'GHS',
      status: 'pending',
      metadata: { adminId, journalGroup }
    }], { session });

    // Notify Finance Team (In-App and Email)
    try {
      const ownerUser = await User.findById(booking.hostel.owner).select('name').session(session);
      const reviewUrl = buildAdminUrl('/finance/payouts');
      await adminNotifier.notifyAdminsOfApproval({
        targetRole: 'finance_admin',
        idempotencyKey: `owner_payout:${payout._id}:pending`,
        subject: 'New Owner Payout Pending Approval',
        emailBody: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e3a8a;">New Owner Payout Pending</h2>
            <p>Hello,</p>
            <p>A new payout of <strong>GHS ${booking.ownerAmount}</strong> has been queued for Hostel Owner <strong>${ownerUser?.name || 'Owner'}</strong> following a successful booking at <strong>${booking.hostel.name}</strong>.</p>
            <p>Review and verify this payout request inside the Payout Queue dashboard.</p>
            <div style="margin: 20px 0;">
              ${reviewUrl ? `<a href="${reviewUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Review Payout Queue</a>` : ''}
            </div>
          </div>
        `,
        inAppTitle: 'New Owner Payout Queued',
        inAppMessage: `Payout of GHS ${booking.ownerAmount} pending approval for Owner ${ownerUser?.name || 'Owner'}.`,
        data: { payoutId: payout._id }
      }, session);
    } catch (err) {
      console.error('Failed to dispatch owner payout request email:', err.message);
    }

    // 5. Notifications
    await createNotifications([
      {
        user: booking.student._id,
        title: 'Payment Confirmed',
        message: `Your payment for ${booking.hostel.name} has been confirmed manually by an admin.`,
        type: 'payment',
        data: { booking: booking._id },
      },
      {
        user: booking.hostel.owner,
        title: 'New Booking Paid',
        message: `A booking for ${booking.hostel.name} was marked as paid manually by an admin.`,
        type: 'booking',
        data: { booking: booking._id },
      }
    ], session);

    logLifecycleEvent('admin_mark_paid', { bookingId: booking._id, adminId });

    // Sync ambassador commission status
    try {
      const ambassadorService = require('./ambassadorService');
      await ambassadorService.syncCommissionStatus(booking, session);
    } catch (err) {
      console.error('Failed to sync ambassador commission on manual payment:', err.message);
    }

    return booking;
  });
};

module.exports = {
  approveBooking,
  cancelBooking,
  markBookingAsPaid
};
