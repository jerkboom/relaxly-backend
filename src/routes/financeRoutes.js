const express = require('express');
const router = express.Router();
const {
  getFinanceSummary,
  getPayoutQueue,
  getPayoutQueueById,
  authorizePayout,
  rejectPayout,
  retryPayout,
  confirmPayoutOtp,
  getTransactionLedger,
  exportLedger
} = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');
const financeGuard = require('../middleware/financeGuardMiddleware');

// PROTECT ALL FINANCE ROUTES
router.use(protect);
router.use(authorizeAdminRoles('super_admin', 'finance_admin'));

router.get('/summary', getFinanceSummary);
router.get('/payout-queue', getPayoutQueue);
router.get('/payout-queue/:id', getPayoutQueueById);
router.get('/ledger', getTransactionLedger);
router.get('/export', exportLedger);

// Mutations require financeGuard
router.post('/payout-queue/:id/approve', financeGuard, authorizePayout);
router.post('/payout-queue/:id/confirm-otp', financeGuard, confirmPayoutOtp);
router.post('/payout-queue/:id/reject', financeGuard, rejectPayout);
router.post('/payout-queue/:id/retry', financeGuard, retryPayout);

module.exports = router;
