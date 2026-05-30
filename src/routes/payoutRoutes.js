const express = require('express');
const router = express.Router();
const { getOwnerPayoutHistory } = require('../controllers/payoutController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

router.get('/my-history', protect, authorizeRoles('owner'), getOwnerPayoutHistory);

module.exports = router;
