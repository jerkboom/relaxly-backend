const express = require('express');
const router = express.Router();

const {
  initializePayment,
  verifyPayment,
  paystackWebhook,
} = require('../controllers/paymentController');

const {
  protect,
  authorizeRoles,
} = require('../middleware/authMiddleware');

const {
  isEmailVerified,
} = require('../middleware/verificationMiddleware');

const { validateObjectIds } = require('../middleware/validationMiddleware');

const checkMaintenanceMode = require('../middleware/maintenanceMiddleware');

// PAYSTACK WEBHOOK
router.post(
  '/webhook',
  paystackWebhook
);

// INITIALIZE PAYMENT
router.post(
  '/initialize',
  protect,
  checkMaintenanceMode,
  authorizeRoles('student'),
  isEmailVerified,
  validateObjectIds(['bookingId', 'booking_id', 'id', '_id'], 'body'),
  initializePayment
);

// VERIFY PAYMENT
router.get(
  '/verify/:reference',
  protect,
  authorizeRoles('student', 'admin'),
  isEmailVerified,
  verifyPayment
);

module.exports = router;
