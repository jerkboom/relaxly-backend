const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const getOwnerAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getAdminAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getAdminDashboardStats = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const Booking = require('../models/Booking');
  const Hostel = require('../models/Hostel');
  const Room = require('../models/Room');

  const totalStudents = await User.countDocuments({ role: 'student' });
  const totalOwners = await User.countDocuments({ role: 'owner' });
  const totalHostels = await Hostel.countDocuments();
  
  // Occupancy Analytics
  const checkedInBookings = await Booking.find({ bookingStatus: 'checked_in' });
  const studentsCheckedIn = checkedInBookings.length;
  
  // Active/Approved but not checked in
  const pendingArrivals = await Booking.countDocuments({ 
    bookingStatus: 'approved', 
    paymentStatus: 'paid',
    checkedIn: { $ne: true }
  });

  const totalRooms = await Room.countDocuments();
  const occupiedRoomNumbers = new Set(checkedInBookings.map(b => b.assignedRoomNumber).filter(Boolean));
  const occupiedRoomsCount = occupiedRoomNumbers.size;

  const stats = {
    totalStudents,
    totalOwners,
    totalHostels,
    occupancy: {
      studentsCheckedIn,
      pendingArrivals,
      occupiedRoomsCount,
      totalRooms,
      vacantRoomsCount: Math.max(0, totalRooms - occupiedRoomsCount)
    },
    system: {
      platformFee: 5.00, // Static for now
      activeSessions: 12 // Mock
    }
  };

  res.status(200).json({ success: true, data: stats });
});

const trackEvent = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true });
});

const getTrafficAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getRevenueAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getConversionFunnels = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const exportAnalytics = asyncHandler(async (req, res) => {
  res.status(200).send('Stub CSV');
});


const University = require('../models/University');
const Hostel = require('../models/Hostel');
const User = require('../models/User');
const cache = require('../utils/cache');
const { sendSuccess } = require('../utils/responseHandler');

const getPublicStats = asyncHandler(async (req, res) => {
  const cacheKey = 'public_homepage_stats';
  const cached = cache.get(cacheKey);
  if (cached) {
    return sendSuccess(res, cached, 'Public stats retrieved from cache');
  }

  const [universitiesCount, hostelsCount, studentsCount] = await Promise.all([
    University.countDocuments(),
    Hostel.countDocuments({ verificationStatus: 'approved' }),
    User.countDocuments({ role: 'student', accountStatus: 'active' })
  ]);

  const stats = {
    universities: universitiesCount,
    hostels: hostelsCount,
    students: studentsCount
  };

  cache.set(cacheKey, stats, 900); // 15 minutes

  sendSuccess(res, stats);
});

module.exports = {
  getPublicStats,
  getOwnerAnalytics,
  getAdminAnalytics,
  getAdminDashboardStats,
  trackEvent,
  getTrafficAnalytics,
  getRevenueAnalytics,
  getConversionFunnels,
  exportAnalytics
};
