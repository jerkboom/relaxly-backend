const express = require('express');
const router = express.Router();
const {
  getEarningsReport,
  exportFinancialCsv,
  exportFinancialExcel,
  exportPayoutsCsv,
  exportPayoutsExcel,
  exportPayoutsPdf
} = require('../controllers/reportController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// PROTECT ALL ROUTES - Owner Only
router.use(protect);
router.use(authorizeRoles('owner'));

router.get('/earnings', getEarningsReport);
router.get('/payouts/csv', exportPayoutsCsv);
router.get('/payouts/excel', exportPayoutsExcel);
router.get('/payouts/pdf', exportPayoutsPdf);

module.exports = router;
