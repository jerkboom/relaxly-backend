const axios = require('axios');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const User = require('../models/User');
const PayoutMethod = require('../models/PayoutMethod');
const TransactionLedger = require('../models/TransactionLedger');
const PayoutQueue = require('../models/PayoutQueue');
const { determineEntrySide } = require('../utils/accounting');
const { logAdminAction } = require('../utils/auditLogger');
const { createNotification } = require('./notificationService');
const { runTransactionWithRetry } = require('../utils/transactionHelper');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const MAX_PAYOUT_ATTEMPTS = 5;

const getPaystackSecret = () => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack secret key is not configured');
  }
  return process.env.PAYSTACK_SECRET_KEY;
};

const getPaystackHeaders = () => ({
  Authorization: `Bearer ${getPaystackSecret()}`,
  'Content-Type': 'application/json',
});

const executeTransfer = async (payoutQueue) => {
  const payoutMethod = await PayoutMethod.findOne({ owner: payoutQueue.owner });

  // STEP 5 — VERIFY RECIPIENT
  const recipientCode = payoutQueue.recipientCode || payoutMethod?.recipientCode;
  
  if (!recipientCode) {
    throw new Error('Recipient code is missing. Owner payout setup incomplete.');
  }

  if (payoutMethod && !payoutMethod.verified) {
      console.warn(`[PAYOUT_WARNING] Payout method for owner ${payoutQueue.owner} is not verified in DB, but recipientCode exists.`);
  }

  // STEP 4 — VERIFY AMOUNT
  const amount = Number(payoutQueue.finalTransferAmount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid transfer amount: ${payoutQueue.finalTransferAmount}. Must be > 0.`);
  }

  const payoutAmountPesewas = Math.round(amount * 100);

  // STEP 1 — TRACE PAYSTACK PAYLOAD
  console.log('TRANSFER PAYLOAD:', {
    recipient: recipientCode,
    amount: payoutQueue.finalTransferAmount,
    currency: payoutQueue.currency || 'GHS'
  });

  try {
    const transferResponse = await axios.post(
      `${PAYSTACK_BASE_URL}/transfer`,
      {
        source: 'balance',
        amount: payoutAmountPesewas,
        recipient: recipientCode,
        reason: `Payout for booking ${payoutQueue.booking}`,
        currency: payoutQueue.currency || 'GHS'
      },
      { headers: getPaystackHeaders() }
    );

    console.log('PAYSTACK SUCCESS RESPONSE:', JSON.stringify(transferResponse.data, null, 2));

    if (!transferResponse.data.status) {
        throw new Error(transferResponse.data.message || 'Transfer failed at Paystack gateway');
    }

    return transferResponse.data.data;
  } catch (error) {
    // STEP 2 — TRACE PAYSTACK RESPONSE
    const errorData = error.response?.data || { message: error.message };
    console.error('FULL PAYSTACK ERROR RESPONSE:', JSON.stringify(errorData, null, 2));
    
    // Add specific checks for common Paystack errors to be helpful in logs
    if (errorData.message?.includes('balance')) {
        console.error('CRITICAL: Insufficient balance in Paystack account for this transfer.');
    }
    if (errorData.message?.includes('disabled')) {
        console.error('CRITICAL: Transfers are disabled on this Paystack account.');
    }

    throw new Error(errorData.message || 'Paystack transfer request failed');
  }
};

const authorizePayout = async (payoutQueueId, adminId, req) => {
  console.log('AUTHORIZE PAYOUT REQUEST:', { payoutQueueId, adminId });
  
  const queueEntry = await PayoutQueue.findById(payoutQueueId).populate('booking');
  if (!queueEntry) throw new Error('Payout queue entry not found');

  // BLOCK IF OWNER PAYOUTS ARE FROZEN
  const owner = await User.findById(queueEntry.owner);
  if (owner && owner.payoutFrozen) {
    throw new Error(`Cannot authorize payout. Owner payouts are frozen: ${owner.payoutFreezeReason || 'No reason provided'}`);
  }

  console.log('PAYOUT RECORD:', JSON.stringify({
    id: queueEntry._id,
    status: queueEntry.status,
    amount: queueEntry.amount,
    finalTransferAmount: queueEntry.finalTransferAmount,
    recipientCode: queueEntry.recipientCode
  }, null, 2));

  if (queueEntry.status !== 'pending' && queueEntry.status !== 'approved' && queueEntry.status !== 'failed') {
    throw new Error(`Cannot authorize payout in status: ${queueEntry.status}`);
  }

  // STEP 6 — VERIFY SUCCESS FLOW
  // pending -> processing
  queueEntry.status = 'processing';
  queueEntry.adminApprovedBy = adminId;
  queueEntry.adminApprovedAt = new Date();
  queueEntry.retryCount += 1;
  await queueEntry.save();

  try {
    const transferData = await executeTransfer(queueEntry);

    // After Paystack transfer initialization succeeds:
    // Store transfer_code and reference
    queueEntry.transferCode = transferData.transfer_code;
    queueEntry.transferReference = transferData.reference;
    queueEntry.paystackTransferCode = transferData.transfer_code; 
    queueEntry.paystackTransferReference = transferData.reference; 
    
    // Also set otpRequired and status
    queueEntry.otpRequired = true;
    queueEntry.status = 'otp_pending';
    
    await queueEntry.save();

    console.log('PAYOUT OTP REQUIRED: Status moved to otp_pending');

    await logAdminAction({ 
      req, 
      actionType: 'PAYOUT_APPROVED', 
      targetType: 'PayoutQueue', 
      targetId: queueEntry._id,
      metadata: {
        amount: queueEntry.finalTransferAmount,
        payoutId: queueEntry._id
      }
    });

    return queueEntry;
  } catch (error) {
    // STEP 3 — TRACE FAILED STATUS
    // Find EXACT line setting status = 'failed'
    console.error(`PAYOUT FAILED (Setting status to 'failed'): ${error.message}`);
    
    queueEntry.status = 'failed';
    queueEntry.failedAt = new Date();
    queueEntry.failureReason = error.message;
    await queueEntry.save();
    
    // NOTIFY OWNER AND ADMIN OF FAILURE
    try {
      const ownerUser = await User.findById(queueEntry.owner).select('name email');
      const formattedAmount = Number(queueEntry.finalTransferAmount).toLocaleString();
      const reference = queueEntry.transferReference || queueEntry._id;

      // 1. In-App for Owner
      await createNotification({
        user: queueEntry.owner,
        title: 'Payout Failed',
        message: `Amount: GHS ${formattedAmount}\nReason: ${error.message}\nReference: ${reference}`,
        type: 'finance',
        data: { payoutId: queueEntry._id, status: 'failed', redirect: '/owner/payout-history' }
      });

      // 2. Email for Owner
      if (ownerUser && ownerUser.email) {
        const sendEmail = require('../utils/sendEmail');
        const failEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #ef4444; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Payout Failed</h2>
              <p>Hello <strong>${ownerUser.name}</strong>,</p>
              <p>We were unable to process your payout request. This is usually due to a temporary provider issue or incomplete account details.</p>
              <div style="background-color: #fef2f2; padding: 25px; border-radius: 12px; border: 1px solid #fee2e2; margin: 30px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #b91c1c; font-size: 14px;">Amount</td>
                    <td style="padding: 8px 0; color: #7f1d1d; font-size: 14px; font-weight: 700; text-align: right;">GHS ${formattedAmount}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Reason</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${error.message}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Reference</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right; font-family: monospace;">${reference}</td>
                  </tr>
                </table>
              </div>
              <p style="font-size: 14px;">Our team has been notified and will investigate. You can also re-check your payout settings in your dashboard.</p>
            </div>
          </div>
        `;
        await sendEmail({ email: ownerUser.email, subject: 'Payout Failed • Relaxly', message: failEmailMessage });
      }

      // 3. Finance Alert for Admins
      const admins = await User.find({ role: { $in: ['super_admin', 'finance_admin'] }, accountStatus: 'active' }).select('_id');
      if (admins.length > 0) {
        const { createNotifications } = require('./notificationService');
        await createNotifications(admins.map(admin => ({
          user: admin._id,
          title: 'Finance Alert: Payout Failed',
          message: `Owner: ${ownerUser?.name || 'Unknown'}\nAmount: GHS ${formattedAmount}\nError: ${error.message}`,
          type: 'finance',
          data: { payoutId: queueEntry._id, redirect: `/finance/payouts?id=${queueEntry._id}` }
        })));
      }
    } catch (notifErr) {
      console.error('[PAYOUT_FAILURE_NOTIF_ERROR]', notifErr.message);
    }

    throw error;
  }
};

/**
 * Finalizes a transfer that requires OTP
 * @param {string} payoutId 
 * @param {string} otp 
 * @param {string} adminId 
 * @param {object} req 
 */
const finalizeTransferOtp = async (payoutId, otp, adminId, req) => {
  console.log('FINALIZING TRANSFER OTP', { payoutId });
  
  const payout = await PayoutQueue.findById(payoutId).populate('booking');
  if (!payout) {
    throw new Error('Payout record not found');
  }

  if (payout.status !== 'otp_pending' && payout.status !== 'otp_failed') {
    throw new Error(`Cannot finalize payout in status: ${payout.status}`);
  }

  if (!payout.transferCode) {
    throw new Error('Transfer code is missing from payout record');
  }

  try {
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transfer/finalize_transfer`,
      {
        transfer_code: payout.transferCode,
        otp: otp
      },
      { headers: getPaystackHeaders() }
    );

    console.log('PAYSTACK OTP RESPONSE:', response.data);

    if (!response.data.status) {
      throw new Error(response.data.message || 'OTP verification failed');
    }

    const transferData = response.data.data;

    // WRAP DATABASE OPERATIONS IN TRANSACTION
    await runTransactionWithRetry(async (session) => {
      const sessionPayout = await PayoutQueue.findById(payout._id).session(session).populate('booking');
      if (!sessionPayout) throw new Error('Payout record not found in session');

      sessionPayout.status = 'paid';
      sessionPayout.otpRequired = false;
      sessionPayout.otpVerifiedAt = new Date();
      sessionPayout.processedAt = new Date();
      sessionPayout.paystackTransferCode = transferData.transfer_code;
      sessionPayout.paystackTransferReference = transferData.reference;
      sessionPayout.transferReference = transferData.reference;
      sessionPayout.failureReason = null;
      await sessionPayout.save({ session });

      console.log('PAYOUT SUCCESSFUL AFTER OTP: Status moved to paid in transaction');

      const journalGroup = `jg-pout-otp-success-${sessionPayout._id}-${Date.now()}`;

      // BALANCED ACCOUNTING FOR PAYOUT
      await TransactionLedger.insertMany([
        {
          booking: sessionPayout.booking._id,
          type: 'owner_payout_completed',
          accountCategory: 'liability',
          amount: sessionPayout.finalTransferAmount,
          direction: 'debit',
          entrySide: 'debit',
          journalGroup,
          status: 'success',
          reference: transferData.reference,
          metadata: { info: 'Liability cleared via payout OTP' },
        },
        {
          booking: sessionPayout.booking._id,
          type: 'owner_payout_completed',
          accountCategory: 'asset',
          amount: sessionPayout.finalTransferAmount,
          direction: 'credit',
          entrySide: 'credit',
          journalGroup,
          status: 'success',
          reference: transferData.reference,
          metadata: { info: 'Cash transferred out via Paystack OTP' },
        }
      ], { session });

      await logAdminAction({ req, actionType: 'PAYOUT_OTP_VERIFIED', targetType: 'PayoutQueue', targetId: sessionPayout._id }, session);

      // Update local variables for notifications to use
      payout.status = sessionPayout.status;
      payout.transferReference = sessionPayout.transferReference;
      payout.finalTransferAmount = sessionPayout.finalTransferAmount;
    });
    
    // START NOTIFICATION FLOW
    try {
      const ownerUser = await User.findById(payout.owner).select('name email');
      const formattedAmount = Number(payout.finalTransferAmount).toLocaleString();
      const payoutDate = new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      // 1. NOTIFY OWNER (In-App)
      await createNotification({
        user: payout.owner,
        title: 'Payout Completed',
        message: `Amount: GHS ${formattedAmount}\nReference: ${payout.transferReference || payout._id}\nStatus: Completed`,
        type: 'finance',
        data: { 
          payoutId: payout._id,
          amount: payout.finalTransferAmount,
          status: 'paid',
          redirect: '/owner/payout-history'
        }
      });

      // 2. NOTIFY OWNER (Email)
      if (ownerUser && ownerUser.email) {
        const ownerEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #059669; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Payout Completed</h2>
              <p style="font-size: 16px;">Hello <strong>${ownerUser.name}</strong>,</p>
              <p style="font-size: 16px;">We are pleased to inform you that your payout request has been successfully processed and the funds have been transferred to your registered account.</p>
              
              <div style="background-color: #f0fdf4; padding: 25px; border-radius: 12px; border: 1px solid #dcfce7; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #15803d; margin-bottom: 20px;">Payout Summary</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #166534; font-size: 14px;">Amount Transferred</td>
                    <td style="padding: 8px 0; color: #064e3b; font-size: 18px; font-weight: 800; text-align: right;">GHS ${formattedAmount}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Reference</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right; font-family: monospace;">${payout.transferReference || payout._id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Date</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${payoutDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Status</td>
                    <td style="padding: 8px 0; text-align: right;">
                      <span style="background-color: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">COMPLETED</span>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin-top: 35px;">
                <a href="${process.env.FRONTEND_URL}/owner/payout-history" style="background-color: #059669; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">View Payout History</a>
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Relaxly • Student Accommodation Made Simple.</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        const sendEmail = require('../utils/sendEmail');
        await sendEmail({
          email: ownerUser.email,
          subject: 'Payout Completed • Relaxly',
          message: ownerEmailMessage
        });
      }

      // 3. NOTIFY ADMINS (Finance Alert)
      const admins = await User.find({
        role: { $in: ['super_admin', 'finance_admin'] },
        accountStatus: 'active'
      }).select('name email');

      if (admins.length > 0) {
        // In-App for Admins
        const adminNotifications = admins.map(admin => ({
          user: admin._id,
          title: 'Finance Alert: Payout Completed',
          message: `Owner: ${ownerUser?.name || 'Unknown'}\nAmount: GHS ${formattedAmount}\nReference: ${payout.transferReference || payout._id}`,
          type: 'finance',
          data: {
            payoutId: payout._id,
            ownerId: payout.owner,
            amount: payout.finalTransferAmount,
            redirect: `/finance/payouts?id=${payout._id}`
          }
        }));

        const { createNotifications } = require('./notificationService');
        await createNotifications(adminNotifications);

        // Admin Audit Log
        const AdminAuditLog = require('../models/AdminAuditLog');
        await AdminAuditLog.create({
          admin: adminId, // The admin who entered the OTP
          adminModel: 'Admin',
          actionType: 'PAYOUT_COMPLETED_NOTIFICATION_SENT',
          targetType: 'PayoutQueue',
          targetId: payout._id,
          severity: 'low',
          status: 'success',
          metadata: {
            payoutId: payout._id,
            ownerId: payout.owner,
            amount: payout.finalTransferAmount,
            reference: payout.transferReference,
            timestamp: new Date()
          }
        });
      }
    } catch (notifError) {
      console.error('[PAYOUT_NOTIFICATION_FAILURE]', notifError.message);
    }

    return payout;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('PAYSTACK OTP ERROR RESPONSE:', JSON.stringify(errorData, null, 2));

    if (errorData.message?.toLowerCase().includes('otp')) {
      payout.status = 'otp_failed';
      payout.failureReason = errorData.message;
      await payout.save();
    } else {
      payout.status = 'failed';
      payout.failedAt = new Date();
      payout.failureReason = errorData.message;
      await payout.save();
    }

    throw new Error(errorData.message || 'OTP verification failed');
  }
};

const rejectPayout = async (payoutQueueId, adminId, req, reason) => {
  const queueEntry = await PayoutQueue.findById(payoutQueueId);
  if (!queueEntry) throw new Error('Payout queue entry not found');

  if (queueEntry.status !== 'pending' && queueEntry.status !== 'failed') {
    throw new Error(`Cannot reject payout in status: ${queueEntry.status}`);
  }

  queueEntry.status = 'cancelled';
  queueEntry.adminApprovedBy = adminId;
  queueEntry.adminApprovedAt = new Date();
  queueEntry.failureReason = reason || 'Rejected by admin';
  await queueEntry.save();

  await logAdminAction({ req, actionType: 'PAYOUT_REJECTED', targetType: 'PayoutQueue', targetId: queueEntry._id, metadata: { reason } });
  return queueEntry;
};

const retryPayout = async (payoutQueueId, adminId, req) => {
  const queueEntry = await PayoutQueue.findById(payoutQueueId);
  if (!queueEntry) throw new Error('Payout queue entry not found');

  if (queueEntry.status !== 'failed') {
    throw new Error('Only failed payouts can be retried');
  }

  if (queueEntry.retryCount >= MAX_PAYOUT_ATTEMPTS) {
    throw new Error('Maximum retry limit reached');
  }

  return await authorizePayout(payoutQueueId, adminId, req);
};

const processPendingPayouts = async () => {
  // OBSOLETE: Auto payouts are disabled. 
  // Function remains empty to satisfy worker signature.
};

module.exports = {
  authorizePayout,
  finalizeTransferOtp,
  rejectPayout,
  retryPayout,
  processPendingPayouts,
};
