const asyncHandler = require('express-async-handler');
const PayoutQueue = require('../models/PayoutQueue');
const { sendSuccess } = require('../utils/responseHandler');

// @desc    Get owner payout history
// @route   GET /api/payouts/my-history
const getOwnerPayoutHistory = asyncHandler(async (req, res) => {
  const ownerId = req.user.id;
  const { status, hostelId, startDate, endDate, page = 1, limit = 10, sort = '-createdAt' } = req.query;

  const query = { owner: ownerId };

  if (status) {
    query.status = status;
  }

  if (hostelId) {
    query.hostel = hostelId;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt['$gte'] = new Date(startDate);
    if (endDate) query.createdAt['$lte'] = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const payouts = await PayoutQueue.find(query)
    .populate('hostel', 'name')
    .populate('payoutMethod')
    .populate({
      path: 'booking',
      select: 'bookingCode room hostel student status roomPrice adminCommission ownerAmount',
      populate: [
        { path: 'student', select: 'name' },
        { path: 'hostel', select: 'name' }
      ]
    })
    .sort(sort)
    .skip(skip)
    .limit(Number(limit));

  const total = await PayoutQueue.countDocuments(query);

  // Calculate summary for this owner
  const allOwnerPayouts = await PayoutQueue.find({ owner: ownerId });
  
  const summary = {
    totalPaidOut: allOwnerPayouts
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0),
    pendingPayouts: allOwnerPayouts
      .filter(p => ['pending', 'approved', 'processing', 'otp_pending'].includes(p.status))
      .reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0),
    failedPayouts: allOwnerPayouts
      .filter(p => ['failed', 'otp_failed'].includes(p.status))
      .reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0),
    lifetimeEarnings: allOwnerPayouts
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + (p.amount || 0) + (p.commissionAmount || 0), 0),
  };

  sendSuccess(res, {
    summary,
    payouts,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

module.exports = {
  getOwnerPayoutHistory
};
