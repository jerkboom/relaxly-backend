const asyncHandler = require('express-async-handler');
const PlatformSettings = require('../models/PlatformSettings');

/**
 * Middleware to block requests when the platform is in maintenance mode.
 * Admin roles are exempted from this block.
 */
const checkMaintenanceMode = asyncHandler(async (req, res, next) => {
  const settings = await PlatformSettings.getSettings();

  if (settings.maintenanceMode) {
    // Check if user is admin
    const userRole = req.user?.role?.toLowerCase();
    const isAdmin = ['super_admin', 'admin', 'finance_admin', 'moderator', 'support_admin'].includes(userRole);

    if (!isAdmin) {
      res.status(503);
      throw new Error('Platform is currently under maintenance. Please try again later.');
    }
  }

  next();
});

module.exports = checkMaintenanceMode;
