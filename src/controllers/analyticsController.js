const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const getOwnerAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getAdminAnalytics = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
});

const getAdminDashboardStats = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: {} });
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
