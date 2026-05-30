const TransactionLedger = require('../models/TransactionLedger');
const User = require('../models/User');
const Booking = require('../models/Booking');
const PayoutQueue = require('../models/PayoutQueue');
const { APIFeatures } = require('../utils/apiFeatures');
const { logAdminAction } = require('../utils/auditLogger');
const { Parser } = require('json2csv');

class FinanceAdminService {
  
  async getFinanceSummary() {
    const [bookingStats] = await Booking.aggregate([
      { $match: { paymentStatus: 'paid' } },
      {
        $group: {
          _id: null,
          grossRevenue: { $sum: { $ifNull: ['$platformGrossRevenue', '$totalPaid'] } },
          platformRevenue: { $sum: { $ifNull: ['$commissionAmount', '$adminCommission'] } },
          platformNetProfit: { $sum: { $ifNull: ['$platformNetProfit', '$adminCommission'] } },
          taxReserve: { $sum: { $ifNull: ['$taxReserve', 0] } },
          platformFinalRetainedProfit: { $sum: { $ifNull: ['$platformFinalRetainedProfit', '$adminCommission'] } },
          serviceFees: { $sum: { $ifNull: ['$serviceFeeAmount', '$bookingFee'] } }
        }
      }
    ]);

    const payoutStats = await PayoutQueue.aggregate([
      {
        $group: {
          _id: '$status',
          total: { $sum: '$finalTransferAmount' }
        }
      }
    ]);

    const payoutsObj = payoutStats.reduce((acc, curr) => {
      acc[curr._id] = curr.total;
      return acc;
    }, {});

    return {
      grossRevenue: bookingStats?.grossRevenue || 0,
      platformRevenue: bookingStats?.platformRevenue || 0,
      platformNetProfit: bookingStats?.platformNetProfit || 0,
      taxReserve: bookingStats?.taxReserve || 0,
      platformFinalRetainedProfit: bookingStats?.platformFinalRetainedProfit || 0,
      pendingPayouts: (payoutsObj['pending'] || 0) + (payoutsObj['approved'] || 0),
      processingPayouts: (payoutsObj['processing'] || 0) + (payoutsObj['otp_pending'] || 0),
      paidPayouts: payoutsObj['paid'] || 0,
      failedPayouts: payoutsObj['failed'] || 0
    };
  }

  async getPayoutQueue(queryObj) {
    const { status } = queryObj;
    let query = {};
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const queue = await PayoutQueue.find(query)
      .populate({
          path: 'booking',
          select: 'paymentReference checkInDate bookingCode code',
          populate: { path: 'hostel', select: 'name location' }
      })
      .populate('owner', 'name email')
      .populate('adminApprovedBy', 'name')
      .sort({ createdAt: -1 });
      
    return queue;
  }

  async getTransactionLedger(queryObj) {
    const { type, search, startDate, endDate, minAmount, maxAmount } = queryObj;
    let query = {};

    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { journalGroup: { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = Number(minAmount);
      if (maxAmount) query.amount.$lte = Number(maxAmount);
    }

    const ledger = await TransactionLedger.find(query)
      .populate({
          path: 'booking',
          select: 'bookingCode amount reference paymentStatus student hostel ownerPayoutStatus',
          populate: [
            { path: 'student', select: 'name email' },
            { 
              path: 'hostel', 
              select: 'name location owner',
              populate: { path: 'owner', select: 'name email' }
            }
          ]
      })
      .sort({ createdAt: -1 })
      .limit(queryObj.limit ? Number(queryObj.limit) : 200)
      .lean();

    return ledger;
  }

  async exportLedgerCSV(queryObj) {
    const ledger = await this.getTransactionLedger({ ...queryObj, limit: 10000 });
    
    const fields = [
      { label: 'Date', value: (row) => row.createdAt ? new Date(row.createdAt).toISOString() : 'N/A' },
      { label: 'Booking ID', value: (row) => row.booking?.bookingCode || 'N/A' },
      { label: 'Type', value: 'type' },
      { label: 'Category', value: 'accountCategory' },
      { label: 'Amount (GHS)', value: 'amount' },
      { label: 'Direction', value: 'direction' },
      { label: 'Status', value: 'status' },
      { label: 'Reference', value: 'reference' },
      { label: 'Journal Group', value: 'journalGroup' },
      { label: 'Student', value: (row) => row.booking?.student?.name || 'N/A' },
      { label: 'Hostel', value: (row) => row.booking?.hostel?.name || 'N/A' },
      { label: 'Owner', value: (row) => row.booking?.hostel?.owner?.name || 'N/A' },
      { label: 'Payout Status', value: (row) => row.booking?.ownerPayoutStatus || 'N/A' }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(ledger);
    return csv;
  }
}

module.exports = new FinanceAdminService();
