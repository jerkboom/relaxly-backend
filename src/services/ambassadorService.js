const User = require('../models/User');
const AmbassadorReferral = require('../models/AmbassadorReferral');
const AmbassadorBooking = require('../models/AmbassadorBooking');
const AmbassadorCampaign = require('../models/AmbassadorCampaign');
const PayoutQueue = require('../models/PayoutQueue');
const Booking = require('../models/Booking');
const PlatformSettings = require('../models/PlatformSettings');
const TransactionLedger = require('../models/TransactionLedger');
const EmailLog = require('../models/EmailLog');
const DeliveryLog = require('../models/DeliveryLog');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { createNotification } = require('./notificationService');
const emailService = require('./emailService');
const { buildAdminUrl } = require('../utils/adminUrl');
const { runTransactionWithRetry } = require('../utils/transactionHelper');
const adminNotifier = require('../utils/adminNotifier');

/**
 * Generate a unique referral code.
 * Example: UG-JOHN-492
 */
const generateReferralCode = async (user, universityName, session) => {
  const uniPrefix = universityName 
    ? universityName.substring(0, 5).toUpperCase().replace(/[^A-Z]/g, '')
    : 'RLX';
  const nameClean = user.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '');
  const randNum = Math.floor(100 + Math.random() * 900);
  
  let code = `${uniPrefix}-${nameClean}-${randNum}`;
  
  // Ensure uniqueness
  const exists = await User.findOne({ 'ambassadorProfile.referralCode': code }).session(session);
  if (exists) {
    return generateReferralCode(user, universityName, session);
  }
  return code;
};

/**
 * Submit an application to become a campus ambassador.
 */
const applyForAmbassador = async (userId, data) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  
  if (user.ambassadorStatus !== 'none' && user.ambassadorStatus !== 'rejected') {
    throw new Error('Ambassador application already exists or is active');
  }

  user.isAmbassador = true;
  user.ambassadorStatus = 'pending';
  user.ambassadorProfile = {
    university: data.university,
    faculty: data.faculty,
    level: data.level,
    hallHostel: data.hallHostel,
    phone: data.phone,
    whatsapp: data.whatsapp,
    instagramUsername: data.instagramUsername,
    tiktokUsername: data.tiktokUsername,
    groupsManagedCount: Number(data.groupsManagedCount) || 0,
    estimatedStudentReach: Number(data.estimatedStudentReach) || 0,
    leadershipExperience: data.leadershipExperience,
    whyBecomeAmbassador: data.whyBecomeAmbassador,
    studentIdUrl: data.studentIdUrl,
    profilePictureUrl: data.profilePictureUrl,
    agreedToTerms: data.agreedToTerms === true || data.agreedToTerms === 'true',
    badge: 'bronze',
    appliedAt: new Date()
  };

  await user.save();

  // Notify Marketing Admins of Ambassador Application Pending Review
  const reviewUrl = buildAdminUrl('/ambassadors');
  adminNotifier.notifyAdminsOfApproval({
    targetRole: 'marketing_admin',
    idempotencyKey: `ambassador_application:${user._id}:pending`,
    subject: 'New Ambassador Application Awaiting Review',
    emailBody: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">New Ambassador Application</h2>
        <p>Hello,</p>
        <p><strong>${user.name}</strong> has applied to become a Campus Ambassador for Relaxly.</p>
        <p>University: <strong>${data.university || 'Unspecified'}</strong></p>
        <p>You can review and approve this application inside the Ambassador Management dashboard.</p>
        <div style="margin: 20px 0;">
          ${reviewUrl ? `<a href="${reviewUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Review Application</a>` : ''}
        </div>
      </div>
    `,
    inAppTitle: 'New Ambassador Application',
    inAppMessage: `Ambassador application pending review from ${user.name}.`,
    data: { userId: user._id }
  }).catch(err => console.error('Failed to dispatch ambassador application email:', err.message));

  return user;
};

/**
 * Approve a pending ambassador application.
 */
const approveAmbassador = async (userId, adminId, internalNotes = '') => {
  return await runTransactionWithRetry(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');
    if (user.ambassadorStatus !== 'pending') {
      throw new Error('Ambassador application is not pending');
    }

    const referralCode = await generateReferralCode(user, user.ambassadorProfile.university, session);

    user.ambassadorStatus = 'approved';
    user.ambassadorProfile.referralCode = referralCode;
    
    const { FRONTEND_URL: frontendUrl } = require('../config/appConfig');
    user.ambassadorProfile.referralUrl = `${frontendUrl}/register?ref=${referralCode}`;
    user.ambassadorProfile.reviewedAt = new Date();
    user.ambassadorProfile.reviewedBy = adminId;
    user.ambassadorProfile.internalNotes = internalNotes || user.ambassadorProfile.internalNotes || '';

    await user.save({ session });

    // Notify student
    await createNotification({
      user: user._id,
      title: 'Ambassador Application Approved!',
      message: `Congratulations! You are now an approved Relaxly Campus Ambassador. Your referral code is ${referralCode}.`,
      type: 'system',
      data: { referralCode }
    }, session);

    return user;
  });
};

/**
 * Reject a pending ambassador application.
 */
const rejectAmbassador = async (userId, adminId, reason, internalNotes = '') => {
  return await runTransactionWithRetry(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');
    if (user.ambassadorStatus !== 'pending') {
      throw new Error('Ambassador application is not pending');
    }

    user.ambassadorStatus = 'rejected';
    user.isAmbassador = false;
    user.ambassadorProfile.rejectionReason = reason;
    user.ambassadorProfile.reviewedAt = new Date();
    user.ambassadorProfile.reviewedBy = adminId;
    user.ambassadorProfile.internalNotes = internalNotes || user.ambassadorProfile.internalNotes || '';

    await user.save({ session });

    await createNotification({
      user: user._id,
      title: 'Ambassador Application Status Update',
      message: `Your campus ambassador application was not approved at this time. Reason: ${reason || 'Does not meet program criteria'}`,
      type: 'system'
    }, session);

    return user;
  });
};

/**
 * Suspend an approved ambassador.
 */
const suspendAmbassador = async (userId, adminId, reason) => {
  return await runTransactionWithRetry(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');
    if (user.ambassadorStatus !== 'approved') {
      throw new Error('Only approved ambassadors can be suspended');
    }

    user.ambassadorStatus = 'suspended';
    user.ambassadorProfile.suspendedAt = new Date();
    user.ambassadorProfile.suspensionReason = reason;

    await user.save({ session });

    await createNotification({
      user: user._id,
      title: 'Ambassador Account Suspended',
      message: `Your ambassador features have been suspended. Reason: ${reason || 'Policy violation'}`,
      type: 'system'
    }, session);

    return user;
  });
};

/**
 * Attribute a new user registration to an ambassador.
 */
const trackReferralSignup = async (referredStudentId, referralCode) => {
  if (!referralCode) return null;

  const ambassador = await User.findOne({ 
    'ambassadorProfile.referralCode': referralCode.trim(),
    ambassadorStatus: 'approved' 
  });
  if (!ambassador) return null;

  // Prevent self-referral
  if (ambassador._id.toString() === referredStudentId.toString()) return null;

  const existingReferral = await AmbassadorReferral.findOne({ referredStudent: referredStudentId });
  if (existingReferral) return existingReferral;

  const referral = await AmbassadorReferral.create({
    ambassador: ambassador._id,
    referredStudent: referredStudentId,
    joinedAt: new Date()
  });

  const logger = require('../utils/logger');
  logger.info(`[REGISTRATION_ATTRIBUTED] Student ${referredStudentId} successfully linked to Ambassador ${ambassador._id} via code ${referralCode}`);

  return referral;
};

/**
 * Calculate dynamic commission based on active campaigns & global settings.
 */
const calculateCommission = async (booking) => {
  // 1. Fetch PlatformSettings for global configuration
  const settings = await PlatformSettings.getSettings();

  // 2. Fetch active target-university campaign
  let campaign = await AmbassadorCampaign.findOne({
    isActive: true,
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() },
    type: 'target_university',
    targetUniversity: booking.university
  });

  // 3. Fallback to general active campaign
  if (!campaign) {
    campaign = await AmbassadorCampaign.findOne({
      isActive: true,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
      type: 'general'
    });
  }

  // 4. Default to global settings
  let type = settings.ambassadorCommissionType || 'flat';
  let rate = settings.ambassadorCommissionValue || 30;

  // Campaign overrides global if exists
  if (campaign) {
    type = campaign.commissionType;
    rate = campaign.commissionValue;
  }

  // 5. Calculate amount
  const amount = type === 'percentage' 
    ? Math.round(((booking.totalPaid || booking.amount) * rate / 100) * 100) / 100 
    : rate;

  return {
    type: type === 'flat' ? 'fixed' : type,
    rate,
    amount,
    campaignId: campaign ? campaign._id : null
  };
};

/**
 * Trigger commission calculation when a referred student pays.
 */
const handleBookingPaymentSuccess = async (bookingId) => {
  const booking = await Booking.findById(bookingId).populate('student');
  if (!booking) return;

  // Check if student was referred
  const referral = await AmbassadorReferral.findOne({ referredStudent: booking.student._id });
  if (!referral) return;

  // Check if ambassador is approved and active
  const ambassador = await User.findById(referral.ambassador);
  if (!ambassador || ambassador.ambassadorStatus !== 'approved') return;

  // Prevent self-referral checks in checkout state
  if (ambassador._id.toString() === booking.student._id.toString()) return;

  // Check if commission already recorded for this booking
  const existingComm = await AmbassadorBooking.findOne({ booking: bookingId });
  if (existingComm) return;

  const commDetails = await calculateCommission(booking);

  const ambassadorBooking = await AmbassadorBooking.create({
    ambassador: ambassador._id,
    referredStudent: booking.student._id,
    booking: booking._id,
    hostel: booking.hostel,
    university: booking.university || 'Unspecified',
    bookingAmount: booking.totalPaid || booking.amount,
    commissionType: commDetails.type,
    commissionRate: commDetails.rate,
    commissionAmount: commDetails.amount,
    bonusCampaignApplied: commDetails.campaignId,
    status: 'pending',
    statusLogs: [{ status: 'pending', reason: 'Automated referral tracking upon successful booking checkout' }]
  });

  const logger = require('../utils/logger');
  logger.info(`[COMMISSION_CREATED] Booking: ${bookingId}, Ambassador: ${ambassador._id}, commissionAmount: GHS ${commDetails.amount}`);

  // Auto-gamification: Update badge levels
  const bookingCount = await AmbassadorBooking.countDocuments({ ambassador: ambassador._id, status: { $in: ['approved', 'paid', 'pending'] } });
  let badge = 'bronze';
  if (bookingCount >= 50) badge = 'legend';
  else if (bookingCount >= 25) badge = 'diamond';
  else if (bookingCount >= 10) badge = 'gold';
  else if (bookingCount >= 3) badge = 'silver';

  if (ambassador.ambassadorProfile.badge !== badge) {
    ambassador.ambassadorProfile.badge = badge;
    
    // Auto-role promotion pathway
    if (bookingCount >= 50 && ambassador.ambassadorRole === 'ambassador') {
      ambassador.ambassadorRole = 'campus_leader';
      await createNotification({
        user: ambassador._id,
        title: 'Rank Promotion: Campus Leader!',
        message: 'Congratulations! You have been promoted to Campus Leader due to outstanding referral volume.',
        type: 'system'
      });
    }
    
    await ambassador.save();
    
    await createNotification({
      user: ambassador._id,
      title: `Badge Unlocked: ${badge.toUpperCase()}!`,
      message: `Outstanding job! You have unlocked the ${badge.toUpperCase()} level.`,
      type: 'system'
    });
  }

  // Notify ambassador
  await createNotification({
    user: ambassador._id,
    title: 'Referral Booking Completed!',
    message: `You earned GHS ${commDetails.amount} commission from a booking by ${booking.student.name}.`,
    type: 'booking',
    data: { ambassadorBooking: ambassadorBooking._id }
  });

  // Synchronize status
  await syncCommissionStatus(booking);
};

/**
 * Reverse commission double-entry ledger entries.
 */
const reverseCommissionLedger = async (commRecord) => {
  // Check if approved entries already exist in the ledger
  const exists = await TransactionLedger.exists({
    booking: commRecord.booking,
    type: 'ambassador_commission_expense'
  });
  if (!exists) return; // Never recorded, no need to reverse

  // Check if already reversed
  const reversed = await TransactionLedger.exists({
    booking: commRecord.booking,
    type: 'ambassador_payable',
    direction: 'debit' // Reversing payable debit
  });
  if (reversed) return;

  const journalGroup = `jg-ambassador-reverse-${commRecord._id}-${Date.now()}`;
  const reference = `comm-rev-${commRecord._id}`;

  await TransactionLedger.create([
    {
      booking: commRecord.booking,
      type: 'ambassador_payable',
      accountCategory: 'liability',
      amount: commRecord.commissionAmount,
      direction: 'debit',
      entrySide: 'debit',
      status: 'success',
      reference,
      journalGroup,
      metadata: { ambassadorId: commRecord.ambassador, info: 'Commission Reversal' }
    },
    {
      booking: commRecord.booking,
      type: 'ambassador_commission_expense',
      accountCategory: 'expense',
      amount: commRecord.commissionAmount,
      direction: 'credit',
      entrySide: 'credit',
      status: 'success',
      reference,
      journalGroup,
      metadata: { ambassadorId: commRecord.ambassador, info: 'Commission Reversal' }
    }
  ]);
};

/**
 * Cascade cancel any pending commissions if the associated booking is cancelled/refunded.
 */
const handleBookingCancellation = async (bookingId, reason = 'Booking cancelled') => {
  const commRecord = await AmbassadorBooking.findOne({ booking: bookingId });
  if (!commRecord) return;

  if (commRecord.status === 'cancelled' || commRecord.status === 'refunded') return;

  commRecord.status = 'cancelled';
  commRecord.statusLogs.push({
    status: 'cancelled',
    changedBy: 'system_cascade',
    reason
  });
  await commRecord.save();

  // Reverse ledger entries if they were created
  await reverseCommissionLedger(commRecord);

  // Check if ambassador balance goes negative
  const wallet = await getAmbassadorWalletDetails(commRecord.ambassador);
  if (wallet.availableBalance < 0) {
    // Notify admin for manual recovery
    await createNotification({
      user: commRecord.ambassador,
      title: 'Balance Negative Adjustment',
      message: `Your balance is adjusted to GHS ${wallet.availableBalance} due to booking cancellation.`,
      type: 'system'
    });
  }

  await createNotification({
    user: commRecord.ambassador,
    title: 'Commission Revoked',
    message: `Commission of GHS ${commRecord.commissionAmount} was revoked because the booking was cancelled.`,
    type: 'system'
  });
};

/**
 * Sync commission status with current booking statuses.
 */
const syncCommissionStatus = async (booking) => {
  const commRecord = await AmbassadorBooking.findOne({ booking: booking._id });
  if (!commRecord) return;

  // 1. Booking Cancelled
  if (booking.bookingStatus === 'cancelled') {
    if (commRecord.status !== 'cancelled') {
      commRecord.status = 'cancelled';
      commRecord.statusLogs.push({ status: 'cancelled', changedBy: 'system_sync', reason: 'Booking cancelled' });
      await commRecord.save();
      await reverseCommissionLedger(commRecord);
    }
    return;
  }

  // 2. Booking Paid and Approved
  if (booking.paymentStatus === 'paid' && booking.bookingStatus === 'approved') {
    if (commRecord.status === 'pending') {
      commRecord.status = 'approved';
      commRecord.statusLogs.push({ status: 'approved', changedBy: 'system_sync', reason: 'Booking paid and approved' });
      await commRecord.save();

      // Record double-entry ledger
      const journalGroup = `jg-ambassador-comm-${commRecord._id}-${Date.now()}`;
      const reference = `comm-${commRecord._id}`;

      await TransactionLedger.create([
        {
          booking: booking._id,
          type: 'ambassador_commission_expense',
          accountCategory: 'expense',
          amount: commRecord.commissionAmount,
          direction: 'debit',
          entrySide: 'debit',
          status: 'success',
          reference,
          journalGroup,
          metadata: { ambassadorId: commRecord.ambassador }
        },
        {
          booking: booking._id,
          type: 'ambassador_payable',
          accountCategory: 'liability',
          amount: commRecord.commissionAmount,
          direction: 'credit',
          entrySide: 'credit',
          status: 'success',
          reference,
          journalGroup,
          metadata: { ambassadorId: commRecord.ambassador }
        }
      ]);

      // Notify ambassador
      await createNotification({
        user: commRecord.ambassador,
        title: 'Commission Approved!',
        message: `Your commission of GHS ${commRecord.commissionAmount} has been approved.`,
        type: 'system'
      });
    }
  }
};

/**
 * Normalizes PayoutQueue documents to match property names expected by the admin/student frontend.
 */
const transformPayout = (payout) => {
  if (!payout) return null;
  const obj = payout.toObject ? payout.toObject() : payout;
  return {
    ...obj,
    ambassador: obj.owner,
    requestedAt: obj.createdAt,
    paymentMethod: obj.transferMethod,
    referenceNumber: obj.transferReference || obj.referenceNumber
  };
};

/**
 * Calculate dynamic wallet parameters for an ambassador.
 */
const getAmbassadorWalletDetails = async (userId) => {
  const bookings = await AmbassadorBooking.find({ ambassador: userId });
  const payouts = await PayoutQueue.find({ owner: userId, payoutType: 'ambassador' });

  const roundMoney = value =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  const pendingCommission = roundMoney(bookings
    .filter(b => b.status === 'pending')
    .reduce((sum, b) => sum + b.commissionAmount, 0));

  const approvedCommission = roundMoney(bookings
    .filter(b => ['approved', 'paid'].includes(b.status))
    .reduce((sum, b) => sum + b.commissionAmount, 0));

  const pendingBalance = roundMoney(payouts
    .filter(p => ['requested', 'under_review', 'approved', 'processing_transfer', 'held'].includes(p.status))
    .reduce((sum, p) => sum + p.amount, 0));

  const paidBalance = roundMoney(payouts
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0));

  // Available balance is approved commissions MINUS (pending + paid), clamped to 0
  const availableBalance = roundMoney(Math.max(0, approvedCommission - (pendingBalance + paidBalance)));

  const totalLifetimeEarnings = roundMoney(paidBalance + availableBalance);
  const totalReferrals = await AmbassadorReferral.countDocuments({ ambassador: userId });
  const successfulBookings = bookings.filter(b => ['approved', 'paid'].includes(b.status)).length;
  const conversionRate = totalReferrals > 0 ? Math.round((successfulBookings / totalReferrals) * 100) : 0;

  const settings = await PlatformSettings.getSettings();
  const minPayout = settings.ambassadorMinPayoutAmount || 100;

  return {
    pendingCommission,
    approvedCommission,
    availableBalance,
    pendingBalance,
    paidBalance,
    totalLifetimeEarnings,
    totalReferrals,
    successfulBookings,
    conversionRate,
    minPayout
  };
};

/**
 * Student request payout submission.
 */
const requestPayout = async (userId, amount, paymentMethod, paymentDetails) => {
  const ambassador = await User.findById(userId);
  if (!ambassador || ambassador.ambassadorStatus !== 'approved') {
    throw new Error('Ambassador account is not approved or suspended');
  }

  // Validate payout destination details
  if (!paymentMethod || !['momo', 'bank'].includes(paymentMethod)) {
    throw new Error('Please select a valid payment method (momo or bank)');
  }

  if (paymentMethod === 'momo') {
    if (!paymentDetails || !paymentDetails.network || !paymentDetails.phoneNumber) {
      throw new Error('Please provide both Mobile Money network provider and phone number');
    }
  } else {
    if (!paymentDetails || !paymentDetails.bankName || !paymentDetails.accountName || !paymentDetails.accountNumber) {
      throw new Error('Please complete bank details (bank name, account name, and account number)');
    }
  }

  // 1. Prevent duplicate pending payout requests
  const existingPending = await PayoutQueue.findOne({
    owner: userId,
    payoutType: 'ambassador',
    status: { $in: ['requested', 'under_review', 'approved', 'processing_transfer', 'held'] }
  });
  if (existingPending) {
    throw new Error('You already have a pending payout request. Please wait for it to be processed.');
  }

  const settings = await PlatformSettings.getSettings();
  const minPayout = settings.ambassadorMinPayoutAmount || 100;
  if (amount < minPayout) {
    throw new Error(`Minimum payout request limit is GHS ${minPayout}`);
  }

  const wallet = await getAmbassadorWalletDetails(userId);
  if (amount > wallet.availableBalance) {
    throw new Error('Requested amount exceeds your available withdrawable balance');
  }

  const payout = await PayoutQueue.create({
    payoutType: 'ambassador',
    owner: userId,
    amount,
    finalTransferAmount: amount,
    transferMethod: paymentMethod,
    provider: paymentMethod === 'momo' ? paymentDetails.network : undefined,
    bankName: paymentMethod === 'bank' ? paymentDetails.bankName : undefined,
    accountNumber: paymentMethod === 'bank' ? paymentDetails.accountNumber : (paymentMethod === 'momo' ? paymentDetails.phoneNumber : undefined),
    accountName: paymentMethod === 'bank' ? paymentDetails.accountName : undefined,
    currency: 'GHS',
    status: 'requested',
    statusLogs: [{ status: 'requested', changedBy: 'ambassador', reason: 'Payout requested by student' }]
  });

  // 2. Notify Ambassador
  await createNotification({
    user: userId,
    title: 'Payout Requested',
    message: `Your request for a payout of GHS ${amount} has been submitted and is pending approval.`,
    type: 'system'
  });

  // 3. Notify Admin and Finance Team (In-App and Email)
  const reviewUrl = buildAdminUrl('/finance/payout-requests');
  adminNotifier.notifyAdminsOfApproval({
    targetRole: 'finance_admin',
    idempotencyKey: `ambassador_payout:${payout._id}:requested`,
    subject: 'New Ambassador Payout Request Pending Approval',
    emailBody: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">New Ambassador Payout Request</h2>
        <p>Hello,</p>
        <p>Ambassador <strong>${ambassador.name}</strong> has requested a payout withdrawal of <strong>GHS ${amount}</strong>.</p>
        <p>Withdrawal Destination: <strong>${paymentMethod === 'momo' ? 'Mobile Money' : 'Bank Transfer'}</strong></p>
        <p>Review and verify this payout request inside the Finance Dashboard.</p>
        <div style="margin: 20px 0;">
          ${reviewUrl ? `<a href="${reviewUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Review Payout Request</a>` : ''}
        </div>
      </div>
    `,
    inAppTitle: 'New Ambassador Payout Request',
    inAppMessage: `Payout request of GHS ${amount} pending approval for ambassador ${ambassador.name}.`,
    data: { payoutId: payout._id }
  }).catch(err => console.error('Failed to dispatch ambassador payout request email:', err.message));

  return transformPayout(payout);
};

/**
 * Fetch student payout history.
 */
const getPayoutsForUser = async (userId) => {
  const payouts = await PayoutQueue.find({ owner: userId, payoutType: 'ambassador' }).sort({ createdAt: -1 });
  return payouts.map(transformPayout);
};

/**
 * Admin list all payout requests.
 */
const getAllPayoutRequests = async (query = {}) => {
  const filter = { payoutType: 'ambassador' };
  if (query.status) {
    filter.status = query.status;
  }
  const payouts = await PayoutQueue.find(filter)
    .populate('owner', 'name email ambassadorProfile')
    .sort({ createdAt: -1 });
  return payouts.map(transformPayout);
};

/**
 * Send Transactional email alerts for ambassador payout state changes using Resend.
 */
const sendAmbassadorPayoutEmail = async (user, payout, templateType, notes = '') => {
  try {
    const formattedAmount = Number(payout.amount).toFixed(2);
    const payoutRef = payout.transferReference || payout._id;
    const transactionId = payout._id;
    const expectedArrival = payout.transferMethod === 'momo' ? 'Within 30 minutes' : 'Within 1-2 business days';

    let displayMethod = '';
    if (payout.transferMethod === 'momo') {
      const providerName = payout.provider || payout.paymentDetails?.network || 'Mobile Money';
      displayMethod = providerName.toUpperCase().includes('MTN')
        ? 'MTN Mobile Money'
        : providerName.toUpperCase().includes('AIR') || providerName.toUpperCase().includes('TIGO')
        ? 'AirtelTigo Mobile Money'
        : providerName.toUpperCase().includes('TELE') || providerName.toUpperCase().includes('VODA')
        ? 'Telecel Mobile Money'
        : `${providerName} Mobile Money`;
    } else {
      const bank = payout.bankName || payout.paymentDetails?.bankName || 'Bank Account';
      displayMethod = `${bank} Transfer`;
    }

    let subject = '';
    let html = '';

    switch (templateType) {
      case 'requested':
        subject = "We've received your payout request";
        html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #1e3a8a;">Payout Request Received</h2>
            <p>Hello ${user.name},</p>
            <p>Your request to withdraw <strong>GHS ${formattedAmount}</strong> has been submitted successfully.</p>
            <p>Status: <strong>Requested</strong></p>
            <p>Our finance team will review and approve the request shortly.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Transaction ID: ${transactionId}</p>
          </div>
        `;
        break;

      case 'approved':
        subject = 'Your payout has been approved';
        html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #10b981;">Payout Approved</h2>
            <p>Hello ${user.name},</p>
            <p>Great news! Your payout request of <strong>GHS ${formattedAmount}</strong> has been approved by our finance team.</p>
            <p>We are now preparing to dispatch the funds to your registered ${payout.transferMethod.toUpperCase()} account.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Transaction ID: ${transactionId}</p>
          </div>
        `;
        break;

      case 'processing':
        subject = 'Your payout is on its way';
        html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #2563eb;">Payout Processing</h2>
            <p>Hello ${user.name},</p>
            <p>Your payout of <strong>GHS ${formattedAmount}</strong> is on its way!</p>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Amount:</strong> GHS ${formattedAmount}</p>
              <p style="margin: 5px 0;"><strong>Paystack Reference:</strong> ${payoutRef}</p>
              <p style="margin: 5px 0;"><strong>Expected Arrival:</strong> ${expectedArrival}</p>
            </div>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Transaction ID: ${transactionId}</p>
          </div>
        `;
        break;

      case 'success':
        subject = 'Your Relaxly Ambassador Payout Has Been Sent 🎉';
        html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background-color: #f4f7fa; color: #1a202c;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
        <!-- Header -->
        <div style="background: #0f172a; padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">RELAXLY</h1>
          <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 12px; text-transform: uppercase; font-weight: bold;">Campus Ambassador Program</p>
        </div>

        <div style="background: #10b981; color: white; padding: 12px; text-align: center; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">PAYOUT SUCCESSFUL</div>

        <!-- Body -->
        <div style="padding: 40px;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px;">Your Payout Has Been Sent 🎉</h2>
          <div style="font-size: 15px; line-height: 1.7; color: #4a5568;">
            <p>Hi ${user.name},</p>
            <p>Great news! Your ambassador commission has been paid successfully.</p>
            
            <div style="background-color: #f8fafc; padding: 25px; border-radius: 15px; border: 1px solid #e2e8f0; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Amount Paid:</strong> <span style="font-size: 18px; color: #10b981; font-weight: 800;">GHS ${formattedAmount}</span></p>
              <p style="margin: 0 0 10px 0;"><strong>Payment Method:</strong> ${displayMethod}</p>
              <p style="margin: 0 0 10px 0;"><strong>Reference:</strong><br/><span style="font-family: monospace; font-size: 12px; color: #64748b;">${payoutRef}</span></p>
              <p style="margin: 0;"><strong>Status:</strong> Completed / Paid</p>
            </div>

            <p>Thank you for helping students discover accommodation through Relaxly. We appreciate your contribution to the platform!</p>
          </div>
          
          <!-- Support Section -->
          <div style="margin-top: 40px; padding: 25px; background: #f8fafc; border-radius: 15px; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 15px 0; font-weight: bold; color: #0f172a; font-size: 14px;">Need Help?</p>
            <p style="margin: 0; font-size: 13px;">If you did not receive these funds within 24 hours, please contact support.</p>
            <div style="margin-top: 15px; display: grid; grid-template-cols: 1fr; gap: 8px;">
               <p style="margin: 0; font-size: 12px;"><strong>Email:</strong> support@relaxly.io</p>
               <p style="margin: 0; font-size: 12px;"><strong>WhatsApp:</strong> +233 50 000 0000</p>
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
        `;
        break;

      case 'rejected':
        subject = 'Your payout request was rejected';
        html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #ef4444;">Payout Request Rejected</h2>
            <p>Hello ${user.name},</p>
            <p>Your request to withdraw <strong>GHS ${formattedAmount}</strong> has been rejected.</p>
            <p><strong>Reason:</strong> ${notes || 'No reason provided by administrator.'}</p>
            <p>If you have any questions, please contact Relaxly Support.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Transaction ID: ${transactionId}</p>
          </div>
        `;
        break;

      case 'held':
        subject = 'Your payout request has been placed on hold';
        html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #f59e0b;">Payout On Hold</h2>
            <p>Hello ${user.name},</p>
            <p>Your request to withdraw <strong>GHS ${formattedAmount}</strong> has been temporarily placed on hold.</p>
            <p><strong>Reason:</strong> ${notes || 'Under review for compliance check.'}</p>
            <p>Our team will reach out to you if any further details are required.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">Transaction ID: ${transactionId}</p>
          </div>
        `;
        break;
    }

    if (emailService.isEmailEnabled()) {
      const result = await emailService.sendEmail({
        email: user.email,
        subject,
        html,
        userId: user._id
      });

      // Log successful delivery in communication history models
      await EmailLog.create({
        user: user._id,
        email: user.email,
        subject,
        status: 'sent',
        sentAt: new Date(),
        messageId: result?.id
      });

      await DeliveryLog.create({
        user: user._id,
        channel: 'EMAIL',
        status: 'SENT',
        sentAt: new Date(),
        referenceId: result?.id
      });
    } else {
      console.warn(`[sendAmbassadorPayoutEmail] Email service disabled. Skipping sending email to ${user.email}`);
    }
  } catch (err) {
    console.error('[sendAmbassadorPayoutEmail_ERROR]', err.message);
  }
};

/**
 * Log double-entry ledger entries for completed ambassador payouts.
 */
const createLedgerRecordsForAmbassadorPayout = async (payout, adminId, referenceNumber, session) => {
  const firstBooking = await AmbassadorBooking.findOne({ ambassador: payout.owner, status: 'approved' }).session(session);
  const bookingId = firstBooking ? firstBooking.booking : new mongoose.Types.ObjectId();
  const journalGroup = `jg-ambassador-payout-${payout._id}-${Date.now()}`;
  const reference = referenceNumber || `payout-${payout._id}`;

  await TransactionLedger.create([
    {
      booking: bookingId,
      type: 'ambassador_payable',
      accountCategory: 'liability',
      amount: payout.amount,
      direction: 'debit',
      entrySide: 'debit',
      status: 'success',
      reference,
      journalGroup,
      metadata: { payoutId: payout._id, ambassadorId: payout.owner, adminId }
    },
    {
      booking: bookingId,
      type: 'ambassador_payout',
      accountCategory: 'asset',
      amount: payout.amount,
      direction: 'credit',
      entrySide: 'credit',
      status: 'success',
      reference,
      journalGroup,
      metadata: { payoutId: payout._id, ambassadorId: payout.owner, adminId }
    }
  ], { session });
};

/**
 * Transition approved referral commission logs to paid.
 */
const markCommissionsAsPaid = async (payout, reference, session) => {
  let remainingAmount = payout.amount;
  const approvedBookings = await AmbassadorBooking.find({ ambassador: payout.owner, status: 'approved' }).sort({ createdAt: 1 }).session(session);
  
  for (const b of approvedBookings) {
    if (remainingAmount <= 0) break;
    b.status = 'paid';
    b.paidAt = new Date();
    b.payoutReference = reference;
    b.statusLogs.push({ status: 'paid', changedBy: 'system_payout', reason: `Payout reference: ${reference}` });
    await b.save({ session });
    remainingAmount -= b.commissionAmount;
  }
};

/**
 * Execute automated Paystack transfer disbursal to Mobile Money or Bank accounts.
 */
const executeAmbassadorTransfer = async (payout) => {
  const ambassador = await User.findById(payout.owner);
  if (!ambassador) throw new Error('Ambassador account not found');

  const paystackRecipientService = require('./paystackRecipientService');
  const axios = require('axios');

  let recipientCode = ambassador.ambassadorProfile?.paystackRecipientCode;

  if (!recipientCode) {
    let result;
    if (payout.transferMethod === 'momo') {
      result = await paystackRecipientService.createMomoRecipient(
        ambassador.name,
        payout.accountNumber,
        payout.provider
      );
    } else {
      result = await paystackRecipientService.createBankRecipient(
        ambassador.name,
        payout.accountNumber,
        payout.bankName
      );
    }

    if (!result || !result.status) {
      throw new Error(result?.message || 'Failed to create Paystack transfer recipient');
    }
    recipientCode = result.data.recipient_code;
    
    // Save to user profile
    await User.updateOne(
      { _id: payout.owner },
      { $set: { 'ambassadorProfile.paystackRecipientCode': recipientCode } }
    );
  }

  const paystackAmount = Math.round(payout.amount * 100); // convert to pesewas

  try {
    const response = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: paystackAmount,
        recipient: recipientCode,
        reason: `Ambassador Payout request: ${payout._id}`,
        currency: 'GHS'
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || 'Paystack transfer request failed');
    }

    return response.data.data; // contains transfer_code, reference, status
  } catch (error) {
    const errData = error.response?.data || { message: error.message };
    throw new Error(errData.message || 'Failed to execute Paystack transfer disbursal');
  }
};

/**
 * Admin review payout requests (approve/reject/hold).
 */
const reviewPayoutRequest = async (payoutId, adminId, action, referenceNumber = '', notes = '') => {
  const payout = await PayoutQueue.findById(payoutId);
  if (!payout) throw new Error('Payout request not found');

  if (payout.status === 'paid') {
    throw new Error('Payout has already been marked as paid');
  }

  const ambassador = await User.findById(payout.owner);
  if (!ambassador) throw new Error('Ambassador account not found');

  let newStatus = payout.status;
  
  if (action === 'under_review') {
    newStatus = 'under_review';
  } else if (action === 'hold') {
    newStatus = 'held';
  } else if (action === 'reject') {
    newStatus = 'rejected';
  } else if (action === 'cancel') {
    newStatus = 'cancelled';
  } else if (action === 'approve' || action === 'pay' || action === 'retry') {
    newStatus = 'approved';
  }

  payout.status = newStatus;
  payout.adminApprovedBy = adminId;
  payout.adminApprovedAt = new Date();
  payout.statusLogs.push({
    status: newStatus,
    changedBy: adminId,
    reason: notes || `Payout request status changed to ${newStatus}`
  });

  // Handle notifications & emails based on newStatus
  if (newStatus === 'under_review') {
    await createNotification({
      user: payout.owner,
      title: 'Payout Under Review',
      message: `Your payout request of GHS ${payout.amount} is now under review.`,
      type: 'system'
    });
  } else if (newStatus === 'held') {
    await createNotification({
      user: payout.owner,
      title: 'Payout On Hold',
      message: `Your payout request of GHS ${payout.amount} has been placed on hold. Reason: ${notes}`,
      type: 'system'
    });
    await sendAmbassadorPayoutEmail(ambassador, payout, 'held', notes);
  } else if (newStatus === 'rejected' || newStatus === 'cancelled') {
    await createNotification({
      user: payout.owner,
      title: 'Payout Rejected',
      message: `Your payout request of GHS ${payout.amount} was rejected. Reason: ${notes}`,
      type: 'system'
    });
    await sendAmbassadorPayoutEmail(ambassador, payout, 'rejected', notes);
  } else if (newStatus === 'approved') {
    // Notify Approved
    await createNotification({
      user: payout.owner,
      title: 'Payout Approved',
      message: `Your payout request of GHS ${payout.amount} has been approved.`,
      type: 'system'
    });
    await sendAmbassadorPayoutEmail(ambassador, payout, 'approved');

    // Trigger Paystack transfer disburse
    payout.status = 'processing_transfer';
    payout.statusLogs.push({
      status: 'processing_transfer',
      changedBy: 'system',
      reason: 'Initiating Paystack transfer disburse'
    });
    await createNotification({
      user: payout.owner,
      title: 'Payout Processing',
      message: `We are initiating transfer for your payout request of GHS ${payout.amount}.`,
      type: 'system'
    });

    try {
      const transferData = await executeAmbassadorTransfer(payout);
      
      payout.transferCode = transferData.transfer_code;
      payout.transferReference = transferData.reference;
      payout.paystackTransferCode = transferData.transfer_code;
      payout.paystackTransferReference = transferData.reference;

      if (transferData.status === 'otp') {
        payout.status = 'otp_pending';
        payout.otpRequired = true;
        payout.statusLogs.push({
          status: 'otp_pending',
          changedBy: 'system',
          reason: 'Paystack transfer requires OTP verification'
        });
        await payout.save();
      } else if (transferData.status === 'success') {
        await runTransactionWithRetry(async (session) => {
          const sessionPayout = await PayoutQueue.findById(payout._id).session(session);
          sessionPayout.status = 'paid';
          sessionPayout.processedAt = new Date();
          sessionPayout.paidAt = new Date();
          sessionPayout.referenceNumber = transferData.reference;
          sessionPayout.statusLogs.push({
            status: 'paid',
            changedBy: 'system',
            reason: 'Paystack transfer completed successfully'
          });
          await sessionPayout.save({ session });

          // Create Finance records
          await createLedgerRecordsForAmbassadorPayout(sessionPayout, adminId, transferData.reference, session);

          // Mark associated bookings as paid
          await markCommissionsAsPaid(sessionPayout, transferData.reference, session);

          // sync values back
          payout.status = sessionPayout.status;
          payout.processedAt = sessionPayout.processedAt;
          payout.paidAt = sessionPayout.paidAt;
          payout.referenceNumber = sessionPayout.referenceNumber;
        });

        // Notify Completed (Ambassador and Admins)
        await dispatchAmbassadorPayoutSuccessNotifications(payout, ambassador, transferData.reference);
      } else {
        // Mark as processing_transfer (waiting for webhook or manual verify)
        payout.status = 'processing_transfer';
        await payout.save();
        await sendAmbassadorPayoutEmail(ambassador, payout, 'processing');
      }
    } catch (err) {
      // Mark as failed
      payout.status = 'failed';
      payout.failedAt = new Date();
      payout.failureReason = err.message;
      payout.statusLogs.push({
        status: 'failed',
        changedBy: 'system',
        reason: `Paystack Transfer Failed: ${err.message}`
      });

      await createNotification({
        user: payout.owner,
        title: 'Payout Transfer Failed',
        message: `Transfer for your payout of GHS ${payout.amount} failed: ${err.message}`,
        type: 'system'
      });

      const notificationService = require('./notificationService');
      await notificationService.notifyAdmins({
        role: 'finance_admin',
        title: 'Ambassador Payout Transfer Failed',
        message: `Ambassador: ${ambassador.name}\nAmount: GHS ${payout.amount}\nError: ${err.message}`,
        subject: 'Ambassador Payout Transfer Failed',
        idempotencyKey: `ambassador_payout:${payout._id}:failed`,
        actionUrl: buildAdminUrl(`/finance/payout-requests?id=${payout._id}`),
        actionLabel: 'Review Payout',
        type: 'finance',
        data: { payoutId: payout._id, ambassadorId: ambassador._id }
      });

      await payout.save();
      throw new Error(`Paystack Transfer Failed: ${err.message}`);
    }
  }

  await payout.save();
  return transformPayout(payout);
};

/**
 * Handle incoming transfer success webhook events from Paystack.
 */
const handleTransferSuccessWebhook = async (transferData) => {
  const reference = transferData.reference;
  const transferCode = transferData.transfer_code;

  const payout = await PayoutQueue.findOne({
    payoutType: 'ambassador',
    $or: [
      { transferReference: reference },
      { paystackTransferReference: reference },
      { transferCode: transferCode },
      { paystackTransferCode: transferCode }
    ]
  });
  if (!payout) return;

  if (payout.status === 'paid') return;

  const ambassador = await User.findById(payout.owner);
  if (!ambassador) return;

  payout.status = 'paid';
  payout.processedAt = new Date();
  payout.paidAt = new Date();
  payout.referenceNumber = reference;
  payout.statusLogs.push({
    status: 'paid',
    changedBy: 'webhook_paystack',
    reason: 'Paystack transfer completed successfully (webhook)'
  });
  await payout.save();

  const logger = require('../utils/logger');
  logger.info(`[PAYOUT_COMPLETED] Payout ID: ${payout._id}, Ambassador: ${payout.owner}, Amount: GHS ${payout.amount}, Ref: ${reference}`);

  // 1. Notify Ambassador and Admins
  await dispatchAmbassadorPayoutSuccessNotifications(payout, ambassador, reference);

  // 2. Create Finance records
  await createLedgerRecordsForAmbassadorPayout(payout, 'system', reference);

  // 3. Mark associated bookings as paid
  await markCommissionsAsPaid(payout, reference);
};

/**
 * Handle incoming transfer failure webhook events from Paystack.
 */
const handleTransferFailureWebhook = async (transferData) => {
  const reference = transferData.reference;
  const transferCode = transferData.transfer_code;

  const payout = await PayoutQueue.findOne({
    payoutType: 'ambassador',
    $or: [
      { transferReference: reference },
      { paystackTransferReference: reference },
      { transferCode: transferCode },
      { paystackTransferCode: transferCode }
    ]
  });
  if (!payout) return;

  if (payout.status === 'failed') return;

  const ambassador = await User.findById(payout.owner);
  if (!ambassador) return;

  payout.status = 'failed';
  payout.failedAt = new Date();
  payout.failureReason = transferData.reason || 'Paystack transfer failed';
  payout.statusLogs.push({
    status: 'failed',
    changedBy: 'webhook_paystack',
    reason: `Paystack transfer failed (webhook): ${transferData.reason || 'No details'}`
  });
  await payout.save();

  // Notify Ambassador
  await createNotification({
    user: payout.owner,
    title: 'Payout Transfer Failed',
    message: `Transfer for your payout of GHS ${payout.amount} failed: ${transferData.reason || 'No details'}`,
    type: 'system'
  });
  await sendAmbassadorPayoutEmail(ambassador, payout, 'rejected', transferData.reason || 'Paystack transfer failed');

  const notificationService = require('./notificationService');
  await notificationService.notifyAdmins({
    role: 'finance_admin',
    title: 'Ambassador Payout Transfer Failed',
    message: `Ambassador: ${ambassador.name}\nAmount: GHS ${payout.amount}\nError: ${transferData.reason || 'Paystack transfer failed'}`,
    subject: 'Ambassador Payout Transfer Failed',
    idempotencyKey: `ambassador_payout:${payout._id}:failed`,
    actionUrl: buildAdminUrl(`/finance/payout-requests?id=${payout._id}`),
    actionLabel: 'Review Payout',
    type: 'finance',
    data: { payoutId: payout._id, ambassadorId: ambassador._id }
  });
};

/**
 * Fetch stats and metrics for the ambassador dashboard.
 */
const getAmbassadorDashboard = async (userId) => {
  const ambassador = await User.findById(userId);
  if (!ambassador || ambassador.ambassadorStatus !== 'approved') {
    throw new Error('Ambassador not found or unauthorized');
  }

  const wallet = await getAmbassadorWalletDetails(userId);
  const bookings = await AmbassadorBooking.find({ ambassador: userId })
    .populate({ path: 'booking', select: 'bookingCode createdAt' })
    .populate('hostel', 'name location')
    .populate('referredStudent', 'name')
    .sort({ createdAt: -1 });

  // Leaderboard placement
  const allPerformers = await AmbassadorBooking.aggregate([
    { $match: { status: { $in: ['pending', 'approved', 'paid'] } } },
    { $group: { _id: '$ambassador', bookingsCount: { $sum: 1 } } },
    { $sort: { bookingsCount: -1 } }
  ]);

  const placement = allPerformers.findIndex(p => p._id.toString() === userId.toString()) + 1;

  const ReferralClick = require('../models/ReferralClick');
  const referralCode = ambassador.ambassadorProfile?.referralCode || '';

  let totalClicks = 0;
  let registrationStartedCount = 0;
  let hostelViewsCount = 0;
  let deviceBreakdown = [];
  let browserBreakdown = [];
  let sourceBreakdown = [];

  if (referralCode) {
    const [clicksCount, regStartCount, hostViews, devAgg, brAgg, srcAgg] = await Promise.all([
      ReferralClick.countDocuments({ referralCode, clickType: 'click' }),
      ReferralClick.countDocuments({ referralCode, clickType: 'registration_started' }),
      ReferralClick.countDocuments({ referralCode, clickType: 'hostel_view' }),
      ReferralClick.aggregate([
        { $match: { referralCode } },
        { $group: { _id: '$device', count: { $sum: 1 } } }
      ]),
      ReferralClick.aggregate([
        { $match: { referralCode } },
        { $group: { _id: '$browser', count: { $sum: 1 } } }
      ]),
      ReferralClick.aggregate([
        { $match: { referralCode } },
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ])
    ]);
    totalClicks = clicksCount;
    registrationStartedCount = regStartCount;
    hostelViewsCount = hostViews;
    deviceBreakdown = devAgg;
    browserBreakdown = brAgg;
    sourceBreakdown = srcAgg;
  }

  return {
    profile: {
      role: ambassador.ambassadorRole,
      badge: ambassador.ambassadorProfile.badge,
      referralCode: ambassador.ambassadorProfile.referralCode,
      referralUrl: ambassador.ambassadorProfile.referralUrl,
      qrCodeUrl: ambassador.ambassadorProfile.qrCodeUrl,
      university: ambassador.ambassadorProfile.university
    },
    metrics: {
      referralsCount: wallet.totalReferrals,
      bookingsCount: wallet.successfulBookings,
      paidEarnings: wallet.paidBalance,
      pendingEarnings: wallet.pendingCommission,
      availableBalance: wallet.availableBalance,
      leaderboardRank: placement || 'N/A',
      minPayout: wallet.minPayout,
      totalClicks,
      registrationStartedCount,
      hostelViewsCount,
      conversionRate: totalClicks > 0 ? parseFloat(((wallet.totalReferrals / totalClicks) * 100).toFixed(1)) : 0,
      bookingConversionRate: totalClicks > 0 ? parseFloat(((wallet.successfulBookings / totalClicks) * 100).toFixed(1)) : 0,
      deviceBreakdown,
      browserBreakdown,
      sourceBreakdown
    },
    bookings
  };
};

/**
 * Fetch leaderboard ranking.
 */
const getAmbassadorLeaderboard = async () => {
  const User = require('../models/User');
  const AmbassadorBooking = require('../models/AmbassadorBooking');
  const AmbassadorReferral = require('../models/AmbassadorReferral');
  const ReferralClick = require('../models/ReferralClick');
  const AmbassadorCampaignRecipient = require('../models/AmbassadorCampaignRecipient');

  const ambassadors = await User.find({ isAmbassador: true, ambassadorStatus: 'approved' });
  const populated = await Promise.all(ambassadors.map(async (amb) => {
    const referralCode = amb.ambassadorProfile?.referralCode || '';
    const userId = amb._id;

    const [bookingsCount, referralsCount, clicksCount, campaignClicks] = await Promise.all([
      AmbassadorBooking.countDocuments({ ambassador: userId, status: { $in: ['pending', 'approved', 'paid'] } }),
      AmbassadorReferral.countDocuments({ ambassador: userId }),
      referralCode ? ReferralClick.countDocuments({ referralCode, clickType: 'click' }) : Promise.resolve(0),
      AmbassadorCampaignRecipient.countDocuments({ user: userId, clicked: true })
    ]);

    const conversionRate = clicksCount > 0 ? parseFloat(((referralsCount / clicksCount) * 100).toFixed(1)) : 0;
    
    // Weighted Score Formula:
    // 40% Bookings (weight 10), 25% Conv Rate (weight 0.5), 20% Registrations (weight 3), 10% Clicks (weight 0.2), 5% Campaign clicks (weight 2)
    const score = (bookingsCount * 10) + (conversionRate * 0.5) + (referralsCount * 3) + (clicksCount * 0.2) + (campaignClicks * 2);

    return {
      _id: userId,
      name: amb.name,
      avatar: amb.avatar || amb.profileImage,
      university: amb.ambassadorProfile?.university || 'Unspecified Campus',
      badge: amb.ambassadorProfile?.badge || 'bronze',
      bookingsCount,
      referralsCount,
      clicksCount,
      conversionRate,
      score: parseFloat(score.toFixed(1))
    };
  }));

  // Sort by weighted score descending
  populated.sort((a, b) => b.score - a.score);

  // Take top 20 and map rank index
  return populated.slice(0, 20).map((p, idx) => ({
    ...p,
    rank: idx + 1
  }));
};

/**
 * Fetch Finance analytics for Ambassador Commission systems.
 */
const getFinanceOverview = async () => {
  const totalCommissionExpense = await TransactionLedger.aggregate([
    { $match: { type: 'ambassador_commission_expense', direction: 'debit' } },
    { $group: { _id: null, sum: { $sum: '$amount' } } }
  ]);

  const pendingPayoutsAgg = await PayoutQueue.aggregate([
    { $match: { payoutType: 'ambassador', status: 'requested' } },
    { $group: { _id: null, sum: { $sum: '$amount' } } }
  ]);

  const approvedLiabilityAgg = await PayoutQueue.aggregate([
    { $match: { payoutType: 'ambassador', status: 'approved' } },
    { $group: { _id: null, sum: { $sum: '$amount' } } }
  ]);

  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0,0,0,0);

  const paidThisMonthAgg = await PayoutQueue.aggregate([
    { $match: { payoutType: 'ambassador', status: 'paid', paidAt: { $gte: thisMonthStart } } },
    { $group: { _id: null, sum: { $sum: '$amount' } } }
  ]);

  return {
    totalCommissionExpense: totalCommissionExpense[0]?.sum || 0,
    pendingCommissionLiability: pendingPayoutsAgg[0]?.sum || 0,
    approvedLiability: approvedLiabilityAgg[0]?.sum || 0,
    paidThisMonth: paidThisMonthAgg[0]?.sum || 0,
    outstandingRequestsCount: await PayoutQueue.countDocuments({ payoutType: 'ambassador', status: 'requested' })
  };
};

/**
 * Dispatch success notifications to the ambassador (in-app, email) and all administrators.
 */
const dispatchAmbassadorPayoutSuccessNotifications = async (payout, ambassador, reference) => {
  try {
    const formattedAmount = Number(payout.amount).toFixed(2);
    const refText = reference || payout.transferReference || payout._id;

    // 1. Notify Ambassador (In-App)
    await createNotification({
      user: payout.owner,
      title: 'Payout Completed',
      message: `🎉 Your payout of GHS ${formattedAmount} has been sent successfully. Reference: ${refText}`,
      type: 'system'
    });

    // 2. Notify Ambassador (Email)
    await sendAmbassadorPayoutEmail(ambassador, payout, 'success');

    // 3. Notify Admins (In-App)
    const admins = await User.find({ role: { $in: ['super_admin', 'finance_admin'] } }).select('_id');
    for (const admin of admins) {
      await createNotification({
        user: admin._id,
        title: 'Ambassador Payout Completed',
        message: `✓ Ambassador payout completed.\n\nRecipient: ${ambassador.name}\nAmount: GHS ${formattedAmount}\nReference: ${refText}`,
        type: 'system'
      });
    }
  } catch (err) {
    console.error('Failed to dispatch ambassador payout notifications:', err.message);
  }
};

// Asynchronous background status poller for queued transfers
const pollAmbassadorTransferStatus = async (payoutId) => {
  const axios = require('axios');
  let attempts = 0;
  const maxAttempts = 10; // Poll for up to 50 seconds (10 attempts * 5s delay)
  const delayMs = 5000;

  const intervalId = setInterval(async () => {
    attempts++;
    try {
      const payout = await PayoutQueue.findById(payoutId);
      if (!payout) {
        clearInterval(intervalId);
        return;
      }

      // If the payout has already been marked paid or failed (e.g. by webhook), stop polling
      if (payout.status === 'paid' || payout.status === 'failed') {
        clearInterval(intervalId);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        console.log(`Polling stopped for payout ${payoutId} after reaching max attempts.`);
        return;
      }

      console.log(`[Poll #${attempts}] transfer_code=${payout.transferCode} Checking status...`);

      const response = await axios.get(
        `https://api.paystack.co/transfer/${payout.transferCode}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
          }
        }
      );

      if (response.data.status && response.data.data) {
        const transferInfo = response.data.data;
        console.log(`[Poll #${attempts}] transfer_code=${payout.transferCode} status=${transferInfo.status} (Payout status: ${payout.status})`);
        console.log(`[Poll #${attempts}] FULL RETRIEVAL DATA:`, JSON.stringify(transferInfo, null, 2));

        if (transferInfo.status === 'success') {
          clearInterval(intervalId);
          console.log(`[Poll #${attempts}] Transfer successful! Updating payout to PAID...`);

          // Mark paid and run completion flow
          payout.status = 'paid';
          payout.processedAt = new Date();
          payout.paidAt = new Date();
          payout.statusLogs.push({
            status: 'paid',
            changedBy: 'system_polling',
            reason: 'Paystack transfer marked successful via status polling'
          });
          await payout.save();

          const ambassador = await User.findById(payout.owner);
          if (ambassador) {
            await dispatchAmbassadorPayoutSuccessNotifications(payout, ambassador, payout.transferReference || payout._id);
          }

          // Create Finance records
          await createLedgerRecordsForAmbassadorPayout(payout, 'system', payout.transferReference || payout._id);

          // Mark associated bookings as paid
          await markCommissionsAsPaid(payout, payout.transferReference || payout._id);

        } else if (transferInfo.status === 'failed' || transferInfo.status === 'reversed') {
          clearInterval(intervalId);
          console.log(`[Poll #${attempts}] Transfer failed! Updating payout to FAILED...`);

          payout.status = 'failed';
          payout.failedAt = new Date();
          payout.failureReason = transferInfo.failures?.[0]?.message || 'Transfer failed';
          payout.statusLogs.push({
            status: 'failed',
            changedBy: 'system_polling',
            reason: `Paystack transfer failed via status polling: ${transferInfo.failures?.[0]?.message || 'Unknown error'}`
          });
          await payout.save();

          // Notify Failed
          await createNotification({
            user: payout.owner,
            title: 'Payout Transfer Failed',
            message: `Transfer for your payout of GHS ${payout.amount} failed.`,
            type: 'system'
          });
        }
      }
    } catch (err) {
      console.error(`Error during Paystack status polling for payout ${payoutId}:`, err.message);
    }
  }, delayMs);
};

// Payout OTP challenge handler
const finalizeAmbassadorTransferOtp = async (payoutId, otp, adminId, req) => {
  const payout = await PayoutQueue.findById(payoutId);
  if (!payout) {
    throw new Error('Payout record not found');
  }

  if (payout.status !== 'otp_pending' && payout.status !== 'otp_failed') {
    throw new Error(`Cannot finalize payout in status: ${payout.status}`);
  }

  if (!payout.transferCode) {
    throw new Error('Transfer code is missing from payout record');
  }

  const axios = require('axios');

  try {
    const response = await axios.post(
      'https://api.paystack.co/transfer/finalize_transfer',
      {
        transfer_code: payout.transferCode,
        otp: otp
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('PAYSTACK AMBASSADOR FINALIZATION RESPONSE:', JSON.stringify(response.data, null, 2));

    if (!response.data.status) {
      throw new Error(response.data.message || 'OTP verification failed');
    }

    const transferData = response.data.data;

    // Save final references returned by Paystack finalization
    if (transferData.status === 'success') {
      await runTransactionWithRetry(async (session) => {
        const sessionPayout = await PayoutQueue.findById(payout._id).session(session);
        if (transferData.transfer_code) {
          sessionPayout.transferCode = transferData.transfer_code;
          sessionPayout.paystackTransferCode = transferData.transfer_code;
        }
        if (transferData.reference) {
          sessionPayout.transferReference = transferData.reference;
          sessionPayout.paystackTransferReference = transferData.reference;
        }
        
        sessionPayout.status = 'paid';
        sessionPayout.otpRequired = false;
        sessionPayout.otpVerifiedAt = new Date();
        sessionPayout.processedAt = new Date();
        sessionPayout.paidAt = new Date();
        sessionPayout.statusLogs.push({
          status: 'paid',
          changedBy: adminId,
          reason: 'Paystack transfer finalized and paid immediately'
        });
        await sessionPayout.save({ session });

        await createLedgerRecordsForAmbassadorPayout(sessionPayout, adminId, transferData.reference || sessionPayout._id, session);
        await markCommissionsAsPaid(sessionPayout, transferData.reference || sessionPayout._id, session);

        // sync values back
        payout.status = sessionPayout.status;
        payout.otpRequired = sessionPayout.otpRequired;
        payout.otpVerifiedAt = sessionPayout.otpVerifiedAt;
        payout.processedAt = sessionPayout.processedAt;
        payout.paidAt = sessionPayout.paidAt;
        payout.transferCode = sessionPayout.transferCode;
        payout.transferReference = sessionPayout.transferReference;
      });

      const ambassador = await User.findById(payout.owner);
      if (ambassador) {
        await dispatchAmbassadorPayoutSuccessNotifications(payout, ambassador, transferData.reference || payout._id);
      }
    } else {
      if (transferData.transfer_code) {
        payout.transferCode = transferData.transfer_code;
        payout.paystackTransferCode = transferData.transfer_code;
      }
      if (transferData.reference) {
        payout.transferReference = transferData.reference;
        payout.paystackTransferReference = transferData.reference;
      }
      // Move status to processing_transfer (waiting for webhook or polling)
      payout.status = 'processing_transfer';
      payout.otpRequired = false;
      payout.otpVerifiedAt = new Date();
      payout.statusLogs.push({
        status: 'processing_transfer',
        changedBy: adminId,
        reason: 'Paystack transfer authorized with OTP successfully'
      });
      await payout.save();

      // Spawn fire-and-forget background status polling
      pollAmbassadorTransferStatus(payout._id).catch(err => {
        console.error('Failed to initiate status polling:', err.message);
      });
    }

    // Log admin action
    const { logAdminAction } = require('../utils/auditLogger');
    if (req) {
      await logAdminAction({
        req,
        actionType: 'AMBASSADOR_PAYOUT_OTP_VERIFIED',
        targetType: 'PayoutQueue',
        targetId: payout._id
      });
    }

    // Return normalized payout details
    return transformPayout(payout);
  } catch (error) {
    const errData = error.response?.data || { message: error.message };
    payout.status = 'otp_failed';
    payout.statusLogs.push({
      status: 'otp_failed',
      changedBy: adminId,
      reason: `OTP Authorization failed: ${errData.message || 'Incorrect OTP'}`
    });
    await payout.save();

    throw new Error(errData.message || 'OTP verification failed. Please try again.');
  }
};

module.exports = {
  applyForAmbassador,
  approveAmbassador,
  rejectAmbassador,
  suspendAmbassador,
  trackReferralSignup,
  handleBookingPaymentSuccess,
  handleBookingCancellation,
  syncCommissionStatus,
  requestPayout,
  getPayoutsForUser,
  getAllPayoutRequests,
  reviewPayoutRequest,
  finalizeAmbassadorTransferOtp,
  getAmbassadorWalletDetails,
  getAmbassadorDashboard,
  getAmbassadorLeaderboard,
  getFinanceOverview
};
