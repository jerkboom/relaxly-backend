const express = require('express');

const router = express.Router();
const { getPublicSettings } = require('../controllers/adminController');
router.get('/settings/public', getPublicSettings);

const {
  body,
} = require('express-validator');

const { validate } = require(
  '../middleware/validationMiddleware'
);

const {
  registerUser,
  loginUser,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
} = require('../controllers/authController');

const {
  protect,
} = require('../middleware/authMiddleware');

// REGISTER
router.post(
  '/register',
  [
    body('name')
      .notEmpty()
      .withMessage('Name is required'),

    body('email')
      .isEmail()
      .withMessage(
        'Valid email required'
      ),

    body('password')
      .isLength({ min: 6 })
      .withMessage(
        'Password must be at least 6 characters'
      ),

    body('role')
      .optional()
      .custom((value) => {
        const normalized = String(value).toLowerCase();
        if (!['student', 'owner'].includes(normalized)) {
          throw new Error('Invalid role. Must be student or owner.');
        }
        return true;
      }),
  ],

  validate,

  registerUser
);

// LOGIN
router.post(
  '/login',
  [
    body('email')
      .isEmail()
      .withMessage(
        'Valid email required'
      ),

    body('password')
      .notEmpty()
      .withMessage(
        'Password required'
      ),
  ],

  validate,

  loginUser
);

// GET CURRENT USER
router.get(
  '/me',
  protect,
  getMe
);

// FORGOT PASSWORD
router.post(
  '/forgot-password',
  [
    body('email')
      .isEmail()
      .withMessage(
        'Valid email required'
      ),
  ],

  validate,

  forgotPassword
);

// RESET PASSWORD
router.put(
  '/reset-password/:token',
  [
    body('password')
      .isLength({ min: 6 })
      .withMessage(
        'Password must be at least 6 characters'
      ),
  ],

  validate,

  resetPassword
);

// VERIFY EMAIL
router.get(
  '/verify-email/:token',
  verifyEmail
);

// RESEND VERIFICATION
router.post(
  '/resend-verification',
  resendVerificationEmail
);

module.exports = router;
