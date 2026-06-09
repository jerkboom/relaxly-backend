const express = require('express');
const router = express.Router();
const {
  getPlatformSettings,
  updatePlatformSettings,
  updateMaintenanceMode,
  updateOwnerCommission,
  getAllUsers,
  updateUserAccountStatus,
  updateUserRole,
  getUserDetails,
  getOwnerPerformance,
  getAdminAuditLogs,
  getMyActivityLogs,
  exportMyActivityLogs,
  getMyActivityLogDetail,
  getAuditLogDetail,
  getAuditLogMetrics,
  exportAuditLogs,
  generateAuditPDF,
  getPendingHostels,
  getModerationStats,
  getSuspiciousHostels,
  getModerationPolicies,
  approveHostel,
  rejectHostel,
  suspendHostel,
  getAllBookings,
  generateInviteCode,
  getAllInviteCodes,
  revokeInviteCode,
  getAllHostelsForAdmin,
  getAllStudentsForAdmin,
  getAllOwnersForAdmin,
  approveBooking,
  cancelBooking,
  markBookingPaid,
  getFinanceOverview,
  getFinanceLedger,
  getFinancePayouts,
  getAnalyticsOverview,
  getAnalyticsRevenueChart,
  getAnalyticsTopHostels,
  getUnreadNotifications,
  getAdminProfile,
  updateAdminProfile,
  updateAdminPassword,
  toggleAdminMfa,
  getAdmins,
  inviteAdmin,
  getProvisionedAdmins,
  updateProvisionedAdminRole,
  updateProvisionedAdminStatus,
  deleteProvisionedAdmin,
  loginAdmin,
  activateAdmin,
  createAdmin,
  deleteAdmin,
  getSystemHealth,
  getFraudMonitoring,
  getLiveActivityFeed,
  getPublicSettings,
  getCacheStats,
  getCustomUniversities,
} = require('../controllers/adminController');

const {
  getTrafficAnalytics,
  getRevenueAnalytics,
  getConversionFunnels,
  exportAnalytics,
} = require('../controllers/analyticsController');
const { confirmPayoutOtp } = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// PUBLIC ADMIN ROUTES
router.post('/auth/login', loginAdmin);
router.post('/admins/activate', activateAdmin);

// ALL OTHER ROUTES ARE PROTECTED
router.use(protect);

// SETTINGS (Super Admin Only)
router.get('/settings', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getPlatformSettings);
router.put('/settings', authorizeAdminRoles('super_admin'), updatePlatformSettings);
router.patch('/settings/maintenance', authorizeAdminRoles('super_admin'), updateMaintenanceMode);

// USER MANAGEMENT
router.get('/users', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllUsers);
router.get('/students', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllStudentsForAdmin);
router.get('/owners', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllOwnersForAdmin);
router.patch('/users/:id/status', authorizeAdminRoles('super_admin', 'moderator'), updateUserAccountStatus);
router.patch('/users/:id/role', authorizeAdminRoles('super_admin'), updateUserRole); // Only Super Admins can change roles   
router.get('/users/:id/details', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getUserDetails);

// OWNER MANAGEMENT
router.get('/owners/:id/performance', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerPerformance);
router.put('/owners/:id/commission', authorizeAdminRoles('super_admin', 'finance_admin'), updateOwnerCommission);

// INVITE CODES
router.post('/invites/generate', authorizeAdminRoles('super_admin', 'moderator'), generateInviteCode);
router.get('/invites', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllInviteCodes);
router.delete('/invites/:id', authorizeAdminRoles('super_admin', 'moderator'), revokeInviteCode);

// CUSTOM UNIVERSITIES REPORT
router.get('/universities/custom', authorizeAdminRoles('super_admin', 'moderator'), getCustomUniversities);

// HOSTEL MODERATION
router.get('/hostels', authorizeAdminRoles('super_admin', 'moderator'), getAllHostelsForAdmin);
router.get('/hostels/pending', authorizeAdminRoles('super_admin', 'moderator'), getPendingHostels);
router.get('/moderation/stats', authorizeAdminRoles('super_admin', 'moderator'), getModerationStats);
router.get('/moderation/suspicious', authorizeAdminRoles('super_admin', 'moderator'), getSuspiciousHostels);
router.get('/moderation/policies', authorizeAdminRoles('super_admin', 'moderator'), getModerationPolicies);
router.patch('/hostels/:id/approve', authorizeAdminRoles('super_admin', 'moderator'), approveHostel);
router.patch('/hostels/:id/reject', authorizeAdminRoles('super_admin', 'moderator'), rejectHostel);
router.patch('/hostels/:id/suspend', authorizeAdminRoles('super_admin', 'moderator'), suspendHostel);

// OPERATIONS
router.get('/bookings', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getAllBookings);  
// AUDIT LOG SYSTEM
router.get('/activity/export', exportMyActivityLogs);
router.get('/activity/:id', getMyActivityLogDetail);
router.get('/activity', getMyActivityLogs);
router.get('/audit-logs', authorizeAdminRoles('super_admin', 'moderator'), getAdminAuditLogs);
router.get('/audit-logs/metrics', authorizeAdminRoles('super_admin', 'moderator'), getAuditLogMetrics);
router.get('/audit-logs/export', authorizeAdminRoles('super_admin'), exportAuditLogs);
router.get('/audit-logs/export/pdf', authorizeAdminRoles('super_admin'), generateAuditPDF);
router.get('/audit-logs/:id', authorizeAdminRoles('super_admin', 'moderator'), getAuditLogDetail);

// FINANCE
router.get('/finance/overview', authorizeAdminRoles('super_admin', 'finance_admin'), getFinanceOverview);
router.get('/finance/ledger', authorizeAdminRoles('super_admin', 'finance_admin'), getFinanceLedger);
router.get('/finance/payouts', authorizeAdminRoles('super_admin', 'finance_admin'), getFinancePayouts);
router.post('/payouts/:id/confirm-otp', authorizeAdminRoles('super_admin', 'finance_admin'), confirmPayoutOtp);

// ANALYTICS
router.get('/analytics/overview', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getAnalyticsOverview);   
router.get('/analytics/revenue-chart', authorizeAdminRoles('super_admin', 'finance_admin'), getAnalyticsRevenueChart);       
router.get('/analytics/top-hostels', authorizeAdminRoles('super_admin', 'moderator'), getAnalyticsTopHostels);
router.get('/analytics/traffic', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getTrafficAnalytics);     
router.get('/analytics/revenue', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getRevenueAnalytics);     
router.get('/analytics/funnels', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getConversionFunnels);    
router.get('/analytics/export', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), exportAnalytics);

// BOOKING ACTIONS
router.patch('/bookings/:id/approve', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), approveBooking);     
router.patch('/bookings/:id/cancel', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), cancelBooking);       
router.patch('/bookings/:id/mark-paid', authorizeAdminRoles('super_admin', 'finance_admin'), markBookingPaid);

// PERSONAL PROFILE
router.get('/profile', getAdminProfile);
router.put('/profile', updateAdminProfile);
router.put('/profile/password', updateAdminPassword);
router.patch('/profile/mfa', toggleAdminMfa);

// ADMIN PROVISIONING (NEW SYSTEM)
router.post('/admins/invite', authorizeAdminRoles('super_admin'), inviteAdmin);
router.get('/admins/provisioned', authorizeAdminRoles('super_admin'), getProvisionedAdmins);
router.patch('/admins/provisioned/:id/role', authorizeAdminRoles('super_admin'), updateProvisionedAdminRole);
router.patch('/admins/provisioned/:id/status', authorizeAdminRoles('super_admin'), updateProvisionedAdminStatus);
router.delete('/admins/provisioned/:id', authorizeAdminRoles('super_admin'), deleteProvisionedAdmin);

// ADMINS
router.get('/admins', authorizeAdminRoles('super_admin'), getAdmins);
router.post('/admins', authorizeAdminRoles('super_admin'), createAdmin);
router.delete('/admins/:id', authorizeAdminRoles('super_admin'), deleteAdmin);

// MONITORING
router.get('/monitoring/system-health', authorizeAdminRoles('super_admin'), getSystemHealth);
router.get('/monitoring/fraud', authorizeAdminRoles('super_admin', 'finance_admin'), getFraudMonitoring);
router.get('/monitoring/activity', authorizeAdminRoles('super_admin', 'moderator'), getLiveActivityFeed);
router.get('/monitoring/cache-stats', authorizeAdminRoles('super_admin'), getCacheStats);

module.exports = router;
