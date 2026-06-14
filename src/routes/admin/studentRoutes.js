const express = require('express');
const router = express.Router();
const { getStudentFullProfile } = require('../../controllers/admin/studentController');
const { protect } = require('../../middleware/authMiddleware');
const authorizeAdminRoles = require('../../middleware/adminPermissionMiddleware');

// All routes here are protected and require admin privileges
router.use(protect);
router.use(authorizeAdminRoles('super_admin', 'moderator', 'support_admin'));

/**
 * @route   GET /api/admin/students/:id/full-profile
 */
router.get('/:id/full-profile', getStudentFullProfile);

module.exports = router;
