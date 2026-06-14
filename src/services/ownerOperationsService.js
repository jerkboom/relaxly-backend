const mongoose = require('mongoose');
const User = require('../models/User');
const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const TransactionLedger = require('../models/TransactionLedger');
const PayoutQueue = require('../models/PayoutQueue');
const PayoutMethod = require('../models/PayoutMethod');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const AdminAuditLog = require('../models/AdminAuditLog');

/**
 * Get deep intelligence overview for a specific owner
 */
const getOwnerOverview = async (ownerId) => {
  const owner = await User.findById(ownerId)
    .select('-password')
    .populate('university', 'name');
  
  if (!owner) throw new Error('Owner not found');

  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');

  // Stats Aggregation
  const bookingStats = await Booking.aggregate([
    { $match: { hostel: { $in: hostelIds } } },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        activeBookings: { $sum: { $cond: [{ $in: ['$bookingStatus', ['pending', 'approved', 'checked_in']] }, 1, 0] } },
        completedBookings: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'completed'] }, 1, 0] } },
        cancelledBookings: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'cancelled'] }, 1, 0] } },
        grossRevenue: { $sum: '$totalPaid' },
        platformFees: { $sum: '$bookingFee' },
        ownerNet: { $sum: '$ownerAmount' }
      }
    }
  ]);

  const payoutStats = await PayoutQueue.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(ownerId) } },
    {
      $group: {
        _id: null,
        totalPayoutCount: { $sum: 1 },
        netPayouts: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$finalTransferAmount', 0] } },
        failedPayouts: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pendingPayouts: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved', 'processing', 'otp_pending']] }, 1, 0] } },
      }
    }
  ]);

  const hostelMetrics = await Hostel.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(ownerId) } },
    {
      $group: {
        _id: null,
        totalHostels: { $sum: 1 },
        totalRooms: { $sum: '$totalRooms' },
        totalAvailableRooms: { $sum: '$availableRooms' },
      }
    }
  ]);

  const reviewStats = await Review.aggregate([
    { $match: { hostel: { $in: hostelIds } } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 }
      }
    }
  ]);

  const bStats = bookingStats[0] || { totalBookings: 0, activeBookings: 0, completedBookings: 0, cancelledBookings: 0, grossRevenue: 0, platformFees: 0, ownerNet: 0 };
  const pStats = payoutStats[0] || { totalPayoutCount: 0, netPayouts: 0, failedPayouts: 0, pendingPayouts: 0 };
  const hMetrics = hostelMetrics[0] || { totalHostels: 0, totalRooms: 0, totalAvailableRooms: 0 };

  const stats = {
    ...bStats,
    ...pStats,
    ...hMetrics,
    totalRevenue: bStats.grossRevenue, // Alignment
    netEarnings: bStats.ownerNet,      // Frontend alignment
    platformCommission: bStats.platformFees, // Frontend alignment
    hostelsCount: hMetrics.totalHostels, // Frontend alignment
    roomsCount: hMetrics.totalRooms,     // Frontend alignment
    avgRating: reviewStats[0]?.avgRating || 0, // Frontend alignment
    averageHostelRating: reviewStats[0]?.avgRating || 0,
    reviewCount: reviewStats[0]?.reviewCount || 0,
  };

  // Occupancy Rate calculation
  stats.occupancyRate = stats.totalRooms > 0 
    ? ((stats.totalRooms - stats.totalAvailableRooms) / stats.totalRooms) * 100 
    : 0;

  const payoutMethod = await PayoutMethod.findOne({ owner: ownerId });

  const verification = {
    isEmailVerified: owner.isEmailVerified,
    isOwnerVerified: owner.isOwnerVerified,
    verificationStatus: owner.verificationStatus,
    approvedAt: owner.approvedAt,
    governmentIdUrl: owner.governmentIdUrl,
  };

  const riskProfile = {
    cancellationRate: stats.totalBookings > 0 ? (stats.cancelledBookings / stats.totalBookings) * 100 : 0,
    failedPayouts: stats.failedPayouts,
    suspensionStatus: owner.accountStatus === 'suspended',
    suspensionReason: owner.suspensionReason,
    payoutFrozen: owner.payoutFrozen,
    payoutFreezeReason: owner.payoutFreezeReason,
    accountStatus: owner.accountStatus,
  };

  return {
    owner: {
      ...owner.toObject(),
      status: owner.accountStatus, // Frontend alignment
      payoutSetupStatus: !!payoutMethod,
    },
    stats,
    verification,
    riskProfile
  };
};

/**
 * Get all hostels owned by a specific owner with metrics
 */
const getOwnerHostels = async (ownerId) => {
  const hostels = await Hostel.find({ owner: ownerId });
  if (!hostels.length) return [];
  
  const hostelIds = hostels.map(h => h._id);

  const [bookingStats, roomCounts] = await Promise.all([
    Booking.aggregate([
      { $match: { hostel: { $in: hostelIds } } },
      {
        $group: {
          _id: '$hostel',
          bookingCount: { $sum: 1 },
          totalEarnings: { $sum: '$ownerAmount' }
        }
      }
    ]),
    Room.aggregate([
      { $match: { hostel: { $in: hostelIds } } },
      {
        $group: {
          _id: '$hostel',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const statsMap = bookingStats.reduce((acc, curr) => {
    acc[curr._id.toString()] = curr;
    return acc;
  }, {});

  const roomMap = roomCounts.reduce((acc, curr) => {
    acc[curr._id.toString()] = curr.count;
    return acc;
  }, {});

  return hostels.map(hostel => {
    const hostelId = hostel._id.toString();
    const stats = statsMap[hostelId] || { bookingCount: 0, totalEarnings: 0 };
    const occupancyRate = hostel.totalRooms > 0 ? ((hostel.totalRooms - hostel.availableRooms) / hostel.totalRooms) * 100 : 0;
    return {
      ...hostel.toObject(),
      status: hostel.verificationStatus, // Frontend alignment
      roomCount: roomMap[hostelId] || 0,
      totalRooms: roomMap[hostelId] || 0, // Frontend alignment
      bookingCount: stats.bookingCount,
      bookingsCount: stats.bookingCount, // Frontend alignment
      earnings: stats.totalEarnings,
      totalRevenue: stats.totalEarnings, 
      ownerNet: stats.totalEarnings, 
      occupancy: occupancyRate,
      occupancyRate: occupancyRate, 
    };
  });
};

/**
 * Get all rooms across all hostels for an owner
 */
const getOwnerRooms = async (ownerId) => {
  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');
  if (!hostelIds.length) return [];

  const rooms = await Room.find({ hostel: { $in: hostelIds } }).populate('hostel', 'name');
  if (!rooms.length) return [];

  const roomIds = rooms.map(r => r._id);

  const bookingStats = await Booking.aggregate([
    { $match: { room: { $in: roomIds } } },
    {
      $group: {
        _id: '$room',
        bookingCount: { $sum: 1 },
        completedBookings: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'completed'] }, 1, 0] } }
      }
    }
  ]);

  const statsMap = bookingStats.reduce((acc, curr) => {
    acc[curr._id.toString()] = curr;
    return acc;
  }, {});

  return rooms.map(room => {
    const roomId = room._id.toString();
    const stats = statsMap[roomId] || { bookingCount: 0, completedBookings: 0 };
    return {
      ...room.toObject(),
      status: room.roomStatus, // Frontend alignment
      roomNumber: room.roomType, // Frontend alignment (Room model lacks roomNumber)
      bookingCount: stats.bookingCount,
      bookingsCount: stats.bookingCount, // Frontend alignment
      completedBookings: stats.completedBookings,
      occupancyRate: room.capacity > 0 ? ((room.capacity - room.availableBeds) / room.capacity) * 100 : 0,
      isOccupied: room.availableBeds === 0, // Frontend alignment
      hostelName: room.hostel?.name
    };
  });
};

/**
 * Get paginated bookings for an owner
 */
const getOwnerBookings = async (ownerId, query = {}) => {
  const { page = 1, limit = 10, status, paymentStatus } = query;
  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');

  const filter = { hostel: { $in: hostelIds } };
  if (status) filter.bookingStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate('student', 'name email phone gender')
      .populate('room', 'roomType price occupancyStyle')
      .populate('hostel', 'name location')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Booking.countDocuments(filter)
  ]);

  const mappedBookings = bookings.map(b => ({
    ...b.toObject(),
    code: b.bookingCode, // Frontend alignment
    status: b.bookingStatus, // Frontend alignment
    totalAmount: b.amount, // Frontend alignment
    checkIn: b.checkInDate, // Frontend alignment
    room: {
      ...b.room?.toObject(),
      roomNumber: b.room?.roomType // Frontend alignment
    }
  }));

  return {
    bookings: mappedBookings,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get paginated transaction ledger entries for an owner
 */
const getOwnerTransactions = async (ownerId, query = {}) => {
  const { page = 1, limit = 20, type, category } = query;
  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');
  const bookingIds = await Booking.find({ hostel: { $in: hostelIds } }).distinct('_id');

  const filter = { booking: { $in: bookingIds } };
  if (type) filter.type = type;
  if (category) filter.accountCategory = category;

  const [transactions, total] = await Promise.all([
    TransactionLedger.find(filter)
      .populate({
        path: 'booking',
        select: 'bookingCode hostel',
        populate: { path: 'hostel', select: 'name' }
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    TransactionLedger.countDocuments(filter)
  ]);

  return {
    transactions: transactions.map(t => ({
      ...t.toObject(),
      transactionType: t.type, // Frontend alignment
      hostelName: t.booking?.hostel?.name,
      bookingCode: t.booking?.bookingCode
    })),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get all payouts for an owner
 */
const getOwnerPayouts = async (ownerId) => {
  const payouts = await PayoutQueue.find({ owner: ownerId })
    .populate({
      path: 'booking',
      select: 'bookingCode hostel',
      populate: { path: 'hostel', select: 'name' }
    })
    .sort({ createdAt: -1 });

  return payouts.map(p => ({
    ...p.toObject(),
    netAmount: p.finalTransferAmount, // Frontend alignment
    providerReference: p.transferReference, // Frontend alignment
    hostelName: p.booking?.hostel?.name,
    bookingCode: p.booking?.bookingCode
  }));
};

/**
 * Get deep analytics for an owner
 */
const getOwnerAnalytics = async (ownerId) => {
  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');
  if (!hostelIds.length) {
    return { monthlyRevenue: [], occupancy: { totalCapacity: 0, currentOccupancy: 0, rate: 0 }, topHostel: null, revenueChartData: [] };
  }
  
  // Monthly Revenue
  const monthlyRevenue = await Booking.aggregate([
    { $match: { hostel: { $in: hostelIds }, paymentStatus: 'paid' } },
    {
      $group: {
        _id: { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        revenue: { $sum: '$ownerAmount' },
        bookings: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);

  // Occupancy Trends
  const rooms = await Room.find({ hostel: { $in: hostelIds } });
  const totalCapacity = rooms.reduce((acc, r) => acc + r.capacity, 0);
  const currentOccupancy = rooms.reduce((acc, r) => acc + (r.capacity - r.availableBeds), 0);

  // Top Hostel
  const topHostelAggregation = await Booking.aggregate([
    { $match: { hostel: { $in: hostelIds }, paymentStatus: 'paid' } },
    {
      $group: {
        _id: '$hostel',
        revenue: { $sum: '$ownerAmount' },
        bookings: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 1 }
  ]);

  let topHostel = null;
  if (topHostelAggregation[0]) {
    const hostelInfo = await Hostel.findById(topHostelAggregation[0]._id).select('name location');
    topHostel = {
      ...topHostelAggregation[0],
      name: hostelInfo?.name,
      location: hostelInfo?.location
    };
  }

  return {
    monthlyRevenue,
    occupancy: {
      totalCapacity,
      currentOccupancy,
      rate: totalCapacity > 0 ? (currentOccupancy / totalCapacity) * 100 : 0
    },
    topHostel,
    revenueTrend: monthlyRevenue.map(m => ({
      date: `${m._id.month}/${m._id.year}`,
      amount: m.revenue
    })),
    revenueChartData: monthlyRevenue.map(m => ({
      label: `${m._id.month}/${m._id.year}`,
      value: m.revenue
    }))
  };
};

/**
 * Get unified activity timeline for an owner
 */
const getOwnerActivityTimeline = async (ownerId) => {
  const hostelIds = await Hostel.find({ owner: ownerId }).distinct('_id');

  // Fetch from multiple sources
  const [bookings, payouts, auditLogs, notifications] = await Promise.all([
    Booking.find({ hostel: { $in: hostelIds } }).sort({ createdAt: -1 }).limit(20),
    PayoutQueue.find({ owner: ownerId }).sort({ createdAt: -1 }).limit(20),
    AdminAuditLog.find({ 
      $or: [
        { targetId: ownerId, targetType: 'User' },
        { targetId: { $in: hostelIds }, targetType: 'Hostel' }
      ]
    }).sort({ createdAt: -1 }).limit(20),
    Notification.find({ user: ownerId }).sort({ createdAt: -1 }).limit(20)
  ]);

  // Map to unified format
  const timeline = [
    ...bookings.map(b => ({
      _id: b._id,
      type: 'booking', // Lowercase to match frontend type
      title: `New Booking: ${b.bookingCode}`,
      description: `Booking for ${b.room?.roomType || 'room'} at ${b.hostel?.name || 'hostel'}`,
      timestamp: b.createdAt,
      createdAt: b.createdAt, // Consistency
      status: b.bookingStatus,
      data: { id: b._id, code: b.bookingCode }
    })),
    ...payouts.map(p => ({
      _id: p._id,
      type: 'payout',
      title: `Payout ${p.status}: ${p.finalTransferAmount} GHS`,
      description: `Settlement for booking ${p.booking?.bookingCode || 'N/A'}`,
      timestamp: p.createdAt,
      createdAt: p.createdAt,
      status: p.status,
      data: { id: p._id, amount: p.finalTransferAmount }
    })),
    ...auditLogs.map(a => ({
      _id: a._id,
      type: 'status_change',
      title: `Admin Action: ${a.actionType}`,
      description: `Action performed by ${a.admin?.name || 'Admin'}`,
      timestamp: a.createdAt,
      createdAt: a.createdAt,
      data: { type: a.actionType, admin: a.admin }
    })),
    ...notifications.map(n => ({
      _id: n._id,
      type: 'verification',
      title: n.title,
      description: n.message,
      timestamp: n.createdAt,
      createdAt: n.createdAt,
      data: { title: n.title }
    }))
  ];

  return timeline.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
};

module.exports = {
  getOwnerOverview,
  getOwnerHostels,
  getOwnerRooms,
  getOwnerBookings,
  getOwnerTransactions,
  getOwnerPayouts,
  getOwnerAnalytics,
  getOwnerActivityTimeline
};
