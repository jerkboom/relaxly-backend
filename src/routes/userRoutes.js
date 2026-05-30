const express =
  require('express');

const router =
  express.Router();

const {
  getUserById,
  getProfile,
  updateProfile,
  verifyInviteCode,
} = require('../controllers/userController');

const {
  protect,
} = require('../middleware/authMiddleware');

// GET PROFILE
router.get(
  '/profile',
  protect,
  getProfile
);

// UPDATE PROFILE
router.put(
  '/profile',
  protect,
  updateProfile
);

// VERIFY INVITE CODE (Owner Only)
router.post(
  '/verify-invite',
  protect,
  verifyInviteCode
);

// GET USER BY ID
router.get(
  '/:id',
  protect,
  getUserById
);

module.exports = router;
