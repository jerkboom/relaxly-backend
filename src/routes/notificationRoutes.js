const express = require('express');
const router = express.Router();

const {
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  trackEmailOpen,
  getCommunicationStats,
  createCampaign,
  getCampaigns,
  getCampaignDetail,
  getTemplates,
  createTemplate,
  previewAudienceCount,
  searchUsersForMessaging,
  sendDirectMessage,
  exportCampaignReport
} = require('../controllers/notificationController');

const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// --- PUBLIC TRACKING ---
router.get('/track/email/:id', trackEmailOpen);

// --- USER NOTIFICATIONS ---
router.get('/unread-count', protect, getUnreadCount);
router.get('/', protect, getNotifications);
router.patch('/read-all', protect, markAllAsRead);
router.patch('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteNotification);

// --- ADMIN BROADCAST CENTER ---
// All these routes require super_admin or admin roles
router.use(protect);
router.use(authorizeAdminRoles('super_admin', 'moderator', 'support_admin', 'admin', 'marketing_admin'));

router.get('/admin/stats', getCommunicationStats);
router.get('/admin/campaigns', getCampaigns);
router.post('/admin/campaigns', createCampaign);
router.get('/admin/campaigns/:id', getCampaignDetail);
router.get('/admin/campaigns/:id/export', exportCampaignReport);

router.get('/admin/templates', getTemplates);
router.post('/admin/templates', createTemplate);

router.post('/admin/audience-preview', previewAudienceCount);
router.get('/admin/users/search', searchUsersForMessaging);
router.post('/admin/users/direct-message', sendDirectMessage);

module.exports = router;
