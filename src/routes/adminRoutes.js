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
  getOwnerTimeline,
  updateSupportSettings,
  getAllAmbassadors,
  approveAmbassador,
  rejectAmbassador,
  suspendAmbassador,
  getAllAmbassadorPayouts,
  reviewAmbassadorPayout,
  getAmbassadorCommissionSettings,
  updateAmbassadorCommissionSettings,
  getAmbassadorFinanceOverview,
  getAllReferrals,
  getAmbassadorTimeline,
  syncLeaderboard,
  resetSeason,
  uploadMarketingAsset,
  getMarketingAssetsAdmin,
  updateMarketingAsset,
  deleteMarketingAsset,
  getMarketingAssetDownloadLogs,
  getMarketingAssetsStats,
  getCampaignTargetPreview,
  createAmbassadorCampaign,
  getAmbassadorCampaigns,
  getAmbassadorCampaignDetail,
  sendTestCampaignEmail,
  deleteAmbassadorCampaign,
  getAdminReferralAnalytics,
  impersonateAmbassadorDashboard
} = require('../controllers/adminController');

const { upload } = require('../middleware/uploadMiddleware');

const {
  getTrafficAnalytics,
  getRevenueAnalytics,
  getConversionFunnels,
  exportAnalytics,
} = require('../controllers/analyticsController');
const studentRoutes = require('./admin/studentRoutes');
const { confirmPayoutOtp } = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// PUBLIC ADMIN ROUTES
router.post('/auth/login', loginAdmin);
router.post('/admins/activate', activateAdmin);

// ALL OTHER ROUTES ARE PROTECTED
router.use(protect);

// STUDENT MANAGEMENT (MODULAR)
router.use('/students', studentRoutes);

// SETTINGS (Super Admin Only)
router.get('/settings', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getPlatformSettings);
router.put('/settings', authorizeAdminRoles('super_admin'), updatePlatformSettings);
router.patch('/settings/maintenance', authorizeAdminRoles('super_admin'), updateMaintenanceMode);
router.put('/platform/support-settings', authorizeAdminRoles('super_admin'), updateSupportSettings);

// USER MANAGEMENT
router.get('/users', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllUsers);
router.get('/students', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllStudentsForAdmin);
router.get('/owners', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getAllOwnersForAdmin);
router.patch('/users/:id/status', authorizeAdminRoles('super_admin', 'moderator'), updateUserAccountStatus);
router.patch('/users/:id/role', authorizeAdminRoles('super_admin'), updateUserRole); // Only Super Admins can change roles   
router.get('/users/:id/details', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getUserDetails);

// OWNER MANAGEMENT
router.get('/owners/:id/performance', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerPerformance);
router.get('/owners/:id/timeline', authorizeAdminRoles('super_admin', 'moderator', 'support_admin'), getOwnerTimeline);
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

// AMBASSADOR MANAGEMENT
router.get('/ambassadors', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin', 'marketing_admin'), getAllAmbassadors);
router.patch('/ambassadors/:id/approve', authorizeAdminRoles('super_admin', 'moderator', 'marketing_admin'), approveAmbassador);
router.patch('/ambassadors/:id/reject', authorizeAdminRoles('super_admin', 'moderator', 'marketing_admin'), rejectAmbassador);
router.patch('/ambassadors/:id/suspend', authorizeAdminRoles('super_admin', 'moderator', 'marketing_admin'), suspendAmbassador);
router.get('/ambassadors/referrals', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getAllReferrals);
router.get('/ambassadors/:id/timeline', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getAmbassadorTimeline);
router.get('/ambassadors/payouts', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator', 'support_admin'), getAllAmbassadorPayouts);
router.patch('/ambassadors/payouts/:id', authorizeAdminRoles('super_admin', 'finance_admin'), reviewAmbassadorPayout);
router.get('/ambassadors/settings', authorizeAdminRoles('super_admin', 'finance_admin'), getAmbassadorCommissionSettings);
router.patch('/ambassadors/settings', authorizeAdminRoles('super_admin', 'finance_admin'), updateAmbassadorCommissionSettings);
router.get('/ambassadors/finance-overview', authorizeAdminRoles('super_admin', 'finance_admin'), getAmbassadorFinanceOverview);
router.post('/ambassadors/leaderboard/sync', authorizeAdminRoles('super_admin', 'moderator', 'marketing_admin'), syncLeaderboard);
router.post('/ambassadors/reset-season', authorizeAdminRoles('super_admin'), resetSeason);
router.post('/ambassadors/marketing-assets', authorizeAdminRoles('super_admin', 'marketing_admin'), upload.single('file'), uploadMarketingAsset);
router.get('/ambassadors/marketing-assets/stats', authorizeAdminRoles('super_admin', 'marketing_admin', 'support_admin', 'moderator'), getMarketingAssetsStats);
router.get('/ambassadors/marketing-assets', authorizeAdminRoles('super_admin', 'marketing_admin', 'support_admin', 'moderator'), getMarketingAssetsAdmin);
router.put('/ambassadors/marketing-assets/:id', authorizeAdminRoles('super_admin', 'marketing_admin'), upload.single('file'), updateMarketingAsset);
router.delete('/ambassadors/marketing-assets/:id', authorizeAdminRoles('super_admin', 'marketing_admin'), deleteMarketingAsset);
router.get('/ambassadors/marketing-assets/:id/downloads', authorizeAdminRoles('super_admin', 'marketing_admin'), getMarketingAssetDownloadLogs);

router.post('/ambassadors/campaigns/target-preview', authorizeAdminRoles('super_admin', 'marketing_admin'), getCampaignTargetPreview);
router.post('/ambassadors/campaigns', authorizeAdminRoles('super_admin', 'marketing_admin'), createAmbassadorCampaign);
router.get('/ambassadors/campaigns', authorizeAdminRoles('super_admin', 'marketing_admin', 'support_admin', 'moderator'), getAmbassadorCampaigns);
router.get('/ambassadors/campaigns/:id', authorizeAdminRoles('super_admin', 'marketing_admin', 'support_admin', 'moderator'), getAmbassadorCampaignDetail);
router.post('/ambassadors/campaigns/:id/test', authorizeAdminRoles('super_admin', 'marketing_admin'), sendTestCampaignEmail);
router.delete('/ambassadors/campaigns/:id', authorizeAdminRoles('super_admin', 'marketing_admin'), deleteAmbassadorCampaign);
router.get('/ambassadors/analytics-overview', authorizeAdminRoles('super_admin', 'marketing_admin', 'finance_admin', 'support_admin', 'moderator'), getAdminReferralAnalytics);
router.get('/ambassadors/:id/dashboard', authorizeAdminRoles('super_admin', 'marketing_admin', 'support_admin', 'moderator'), impersonateAmbassadorDashboard);

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
