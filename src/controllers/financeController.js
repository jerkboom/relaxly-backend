const asyncHandler = require('express-async-handler');
const financeAdminService = require('../services/financeAdminService');
const payoutService = require('../services/payoutService');
const { sendSuccess } = require('../utils/responseHandler');
const PayoutQueue = require('../models/PayoutQueue');
const sendEmail = require('../utils/sendEmail');

// @desc    Get platform financial summary
// @route   GET /api/finance/summary
const getFinanceSummary = asyncHandler(async (req, res) => {
  const data = await financeAdminService.getFinanceSummary();
  sendSuccess(res, data);
});

// @desc    Get payout queue
// @route   GET /api/finance/payout-queue
const getPayoutQueue = asyncHandler(async (req, res) => {
  const queue = await financeAdminService.getPayoutQueue(req.query);
  sendSuccess(res, queue);
});

// @desc    Get single payout queue entry
// @route   GET /api/finance/payout-queue/:id
const getPayoutQueueById = asyncHandler(async (req, res) => {
  const item = await PayoutQueue.findById(req.params.id)
    .populate({
      path: 'booking',
      populate: [
        { path: 'student', select: 'name email' },
        { path: 'hostel', select: 'name location' }
      ]
    })
    .populate('owner', 'name email')
    .populate('adminApprovedBy', 'name');
    
  if (!item) {
    res.status(404);
    throw new Error('Payout queue entry not found');
  }
  
  sendSuccess(res, item);
});

// @desc    Authorize a payout
// @route   POST /api/finance/payout-queue/:id/approve
const authorizePayout = asyncHandler(async (req, res) => {
  const payoutId = req.params.id;
  // STEP: LOG BEFORE APPROVAL
  console.log('APPROVE PAYOUT REQUEST:', payoutId);

  const payout = await PayoutQueue.findById(payoutId).populate('owner', 'name email');
  if (!payout) {
    res.status(404);
    throw new Error('Payout record not found');
  }

  // STEP: LOG AFTER QUEUE FETCH
  console.log('PAYOUT RECORD:', JSON.stringify(payout, null, 2));

  // VERIFY
  // Allow pending, approved, or failed (for retries)
  if (payout.status !== 'pending' && payout.status !== 'approved' && payout.status !== 'failed') {
    res.status(400);
    throw new Error(`Cannot authorize payout in status: ${payout.status}`);
  }

  if (!payout.recipientCode) {
    res.status(400);
    throw new Error('Recipient code is missing. Authorization blocked.');
  }

  if (Number(payout.finalTransferAmount) <= 0) {
    res.status(400);
    throw new Error(`Invalid payout amount: ${payout.finalTransferAmount}. Authorization blocked.`);
  }

  const result = await payoutService.authorizePayout(payoutId, req.user.id, req);

  // SEND EMAIL NOTIFICATION TO OWNER (Non-blocking)
  if (payout.owner && payout.owner.email) {
    const amount = payout.finalTransferAmount;
    const currency = payout.currency || 'GHS';
    const ownerName = payout.owner.name;
    const reference = payout._id;
    const date = new Date().toLocaleDateString();

    const emailOptions = {
      email: payout.owner.email,
      subject: 'Payout Approved • Relaxly',
      message: `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background-color: #f4f7fa; color: #1a202c;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
        <!-- Header -->
        <div style="background: #0f172a; padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">RELAXLY</h1>
          <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 12px; text-transform: uppercase; font-weight: bold;">Trusted Student Housing Platform</p>
        </div>

        <div style="background: #10b981; color: white; padding: 12px; text-align: center; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">PAYOUT APPROVED</div>

        <!-- Body -->
        <div style="padding: 40px;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px;">Payout Approval Confirmation</h2>
          <div style="font-size: 15px; line-height: 1.7; color: #4a5568;">
            
    <p>Hello ${ownerName},</p>
    <p>Your payout request has been reviewed and approved by the Relaxly Finance Team.</p>
    <p>The transfer has been scheduled and is currently being processed through our payment partner.</p>
    
    <div style="background-color: #f8fafc; padding: 25px; border-radius: 15px; border: 1px solid #e2e8f0; margin: 25px 0;">
      <p style="margin: 0 0 10px 0;"><strong>Amount:</strong> ${amount} ${currency}</p>
      <p style="margin: 0 0 10px 0;"><strong>Payout Reference:</strong><br/><span style="font-family: monospace; font-size: 12px; color: #64748b;">${reference}</span></p>
      <p style="margin: 0 0 10px 0;"><strong>Approval Date:</strong> ${date}</p>
      <p style="margin: 0 0 10px 0;"><strong>Status:</strong> Processing</p>
      <p style="margin: 0;"><strong>Destination:</strong><br/><span style="font-size: 13px; color: #64748b;">Registered Account (Paystack)</span></p>
    </div>

    <p><strong>What happens next?</strong></p>
    <ul style="padding-left: 20px;">
      <li>The transfer is being processed via our gateway.</li>
      <li>Funds should arrive in your payout account shortly.</li>
      <li>Processing times may vary depending on your provider.</li>
    </ul>

    <p>Note that Relaxly has absorbed all transaction fees, ensuring you receive your full earnings.</p>
    
          </div>
          
          <!-- Support Section -->
          <div style="margin-top: 40px; padding: 25px; background: #f8fafc; border-radius: 15px; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 15px 0; font-weight: bold; color: #0f172a; font-size: 14px;">Need Help?</p>
            <p style="margin: 0; font-size: 13px;">If you have questions, please contact the Relaxly Support Team.</p>
            <div style="margin-top: 15px; display: grid; grid-template-cols: 1fr; gap: 8px;">
               <p style="margin: 0; font-size: 12px;"><strong>Email:</strong> support@relaxly.io</p>
               <p style="margin: 0; font-size: 12px;"><strong>WhatsApp:</strong> +233 50 000 0000</p>
               <p style="margin: 0; font-size: 12px;"><strong>Phone:</strong> +233 50 000 0000</p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="color: #0f172a; font-weight: bold; margin: 0; font-size: 16px;">Relaxly</p>
          <p style="color: #64748b; margin: 5px 0 20px 0; font-size: 12px; italic">Making Student Accommodation Simple.</p>
          <p style="color: #94a3b8; margin: 0; font-size: 11px; line-height: 1.6;">
            This is an automated message. Please do not reply directly to this email.<br/>
            © 2026 Relaxly. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `
    };

    sendEmail(emailOptions).catch(err => {
      console.error('FAILED TO SEND PAYOUT APPROVAL EMAIL:', err.message);
    });
  }

  sendSuccess(res, result, 'Payout authorized and processed successfully');
});

// @desc    Reject a payout
// @route   POST /api/finance/payout-queue/:id/reject
const rejectPayout = asyncHandler(async (req, res) => {
  console.log('REJECT PAYOUT REQUEST RECEIVED:', req.params.id);
  const { reason } = req.body;
  const result = await payoutService.rejectPayout(req.params.id, req.user.id, req, reason);
  sendSuccess(res, result, 'Payout rejected successfully');
});

// @desc    Retry a failed payout
// @route   POST /api/finance/payout-queue/:id/retry
const retryPayout = asyncHandler(async (req, res) => {
  console.log('RETRY PAYOUT REQUEST RECEIVED:', req.params.id);
  const result = await payoutService.retryPayout(req.params.id, req.user.id, req);
  sendSuccess(res, result, 'Payout retried successfully');
});

// @desc    Confirm payout with OTP
// @route   POST /api/finance/payout-queue/:id/confirm-otp
const confirmPayoutOtp = asyncHandler(async (req, res) => {
  const payoutId = req.params.id;
  const { otp } = req.body;

  if (!otp) {
    res.status(400);
    throw new Error('OTP is required');
  }

  const result = await payoutService.finalizeTransferOtp(payoutId, otp, req.user.id, req);
  sendSuccess(res, result, 'Payout OTP verified and transfer completed');
});

// @desc    Get transaction ledger explorer
// @route   GET /api/finance/ledger
const getTransactionLedger = asyncHandler(async (req, res) => {
  const ledger = await financeAdminService.getTransactionLedger(req.query);
  sendSuccess(res, ledger);
});

// @desc    Export transaction ledger as CSV
// @route   GET /api/finance/export
const exportLedger = asyncHandler(async (req, res) => {
  const csv = await financeAdminService.exportLedgerCSV(req.query);
  const fileName = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  res.status(200).send(csv);
});

module.exports = {
  getFinanceSummary,
  getPayoutQueue,
  getPayoutQueueById,
  authorizePayout,
  rejectPayout,
  retryPayout,
  confirmPayoutOtp,
  getTransactionLedger,
  exportLedger
};
