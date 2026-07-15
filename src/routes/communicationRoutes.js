const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

const {
  getStats,
  getCampaigns,
  createCampaign,
  getCampaignDetail,
  sendTestCampaign,
  getBroadcasts,
  createBroadcast,
  searchUsers,
  sendDirectMessage,
  getDeliveryLogs,
  retryDeliveryLog,
  getTemplates,
  createTemplate,
  updateTemplate,
  getAnalytics,
  createEmergencyAlert,
  getSettings,
  updateSettings,
  testResendConnection,
  exportLogs,
  retryFailedCampaign,
  previewAudienceCount
} = require('../controllers/communicationController');

// All communication routes require admin privileges
router.use(protect);
router.use(authorizeAdminRoles('super_admin', 'admin', 'moderator', 'support_admin', 'marketing_admin'));

router.get('/stats', getStats);

router.get('/campaigns', getCampaigns);
router.post('/campaigns', createCampaign);
router.get('/campaigns/:id', getCampaignDetail);
router.post('/campaigns/:id/retry-failed', retryFailedCampaign);
router.post('/campaigns/test', sendTestCampaign);
router.post('/audience-preview', previewAudienceCount);

router.get('/broadcasts', getBroadcasts);
router.post('/broadcasts', createBroadcast);

router.get('/users/search', searchUsers);
router.post('/direct-messages', sendDirectMessage);

router.get('/delivery-logs', getDeliveryLogs);
router.post('/delivery-logs/:id/retry', retryDeliveryLog);

router.get('/templates', getTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);

router.get('/analytics', getAnalytics);

router.post('/emergency', createEmergencyAlert);

router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/settings/test-connection', testResendConnection);

router.get('/export', exportLogs);

module.exports = router;
