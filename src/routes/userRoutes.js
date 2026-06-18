const express =
  require('express');

const router =
  express.Router();



const {
  protect,
} = require('../middleware/authMiddleware');


const {
  getUserById,
  getProfile,
  updateProfile,
  verifyInviteCode,
  toggleWishlist,
  getWishlist,
} = require('../controllers/userController');

// WISHLIST
router.get('/wishlist', protect, getWishlist);
router.post('/wishlist/:hostelId', protect, toggleWishlist);

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
