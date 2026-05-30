const express = require('express');
const router = express.Router();
const {
  sendDirectMessage,
  createCampaign,
  getCampaigns,
  getCommunicationStats,
  getTemplates,
  createTemplate,
  previewAudienceCount,
  searchUsersForMessaging,
  getNotifications
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// ALL COMMUNICATION ROUTES REQUIRE ADMIN PRIVILEGES
router.use(protect);
router.use(authorizeAdminRoles('super_admin', 'admin', 'moderator', 'support_admin'));

/**
 * @route   POST /api/communication/direct-message
 * @desc    Send a direct message to a specific user via multiple channels
 */
router.post('/direct-message', sendDirectMessage);

/**
 * @route   POST /api/communication/campaign
 * @alias   POST /api/communication/broadcast
 * @desc    Create and execute a broadcast campaign
 */
router.post('/campaign', createCampaign);
router.post('/broadcast', createCampaign);

/**
 * @route   GET /api/communication/stats
 * @desc    Get communication dashboard statistics
 */
router.get('/stats', getCommunicationStats);

/**
 * @route   GET /api/communication/history
 * @desc    Get history of sent campaigns
 */
router.get('/history', getCampaigns);

/**
 * @route   GET /api/communication/inbox
 * @desc    Get recent notifications/messages for the admin
 */
router.get('/inbox', getNotifications);

/**
 * @route   GET /api/communication/templates
 * @desc    Get all message templates
 */
router.get('/templates', getTemplates);

/**
 * @route   POST /api/communication/templates
 * @desc    Create a new message template
 */
router.post('/templates', createTemplate);

/**
 * @route   POST /api/communication/audience-preview
 * @desc    Preview recipient count for a specific audience segment
 */
router.post('/audience-preview', previewAudienceCount);

/**
 * @route   GET /api/communication/users/search
 * @desc    Search for users to send direct messages to
 */
router.get('/users/search', searchUsersForMessaging);

module.exports = router;
