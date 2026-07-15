const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const PlatformSettings = require('../models/PlatformSettings');
const { sendSuccess } = require('../utils/responseHandler');

// @desc    Get support contact settings (publicly accessible)
// @route   GET /api/platform/support-settings
router.get('/support-settings', asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();
  const support = settings.supportSettings;
  
  // Calculate Online / Offline status
  let isOnline = false;
  try {
    const { workingHours } = support;
    if (workingHours) {
      const timezone = workingHours.timezone || 'Africa/Accra';
      
      // Get current time in target timezone
      const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
      const day = nowInTz.getDay(); // 0: Sunday, 1: Monday, ..., 6: Saturday
      const hours = nowInTz.getHours();
      const minutes = nowInTz.getMinutes();
      const currentTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      
      const isWeekend = (day === 0 || day === 6);
      const schedule = isWeekend ? workingHours.weekend : workingHours.weekdays;
      
      if (schedule && schedule.open && schedule.close) {
        isOnline = (currentTimeStr >= schedule.open && currentTimeStr <= schedule.close);
      }
    }
  } catch (err) {
    console.error('Failed to calculate support online status:', err.message);
  }
  
  sendSuccess(res, {
    ...support.toObject(),
    isOnline
  }, 'Support settings retrieved successfully');
}));

// @desc    Process Resend incoming webhooks
// @route   POST /api/platform/resend-webhook
const { handleResendWebhook } = require('../controllers/communicationController');
router.post('/resend-webhook', handleResendWebhook);

module.exports = router;
