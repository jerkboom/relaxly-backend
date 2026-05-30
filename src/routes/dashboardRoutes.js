const express =
  require('express');

const router =
  express.Router();

const {
  getStudentDashboard,
  getOwnerDashboard,
} = require(
  '../controllers/dashboardController'
);

const {
  protect,
  authorizeRoles,
} = require(
  '../middleware/authMiddleware'
);

const {
  isOwnerApproved,
} = require('../middleware/verificationMiddleware');

router.get(
  '/student',
  protect,
  authorizeRoles('student'),
  getStudentDashboard
);

router.get(
  '/owner',
  protect,
  authorizeRoles('owner'),
  isOwnerApproved,
  getOwnerDashboard
);

module.exports = router;
