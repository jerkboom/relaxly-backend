const express = require('express');
const router = express.Router();
const {
  getOwnerAnalytics,
  getAdminAnalytics,
  getAdminDashboardStats,
  trackEvent,
  getPublicStats,
} = require('../controllers/analyticsController');
const {
  protect,
  authorizeRoles,
} = require('../middleware/authMiddleware');

// Public tracking route
router.post('/track', trackEvent);

// Public stats route
router.get('/public-stats', getPublicStats);

// Public stats route
router.get('/public-stats', getPublicStats);

// Owner analytics
router.get(
  '/owner',
  protect,
  authorizeRoles('owner'),
  getOwnerAnalytics
);

// Admin analytics detailed
router.get(
  '/admin',
  protect,
  authorizeRoles('super_admin', 'finance_admin', 'moderator'),
  getAdminAnalytics
);

// Admin dashboard summary
router.get(
  '/admin/summary',
  protect,
  authorizeRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'),
  getAdminDashboardStats
);

module.exports = router;
