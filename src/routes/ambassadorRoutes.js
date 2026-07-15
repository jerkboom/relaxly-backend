const express = require('express');
const router = express.Router();
const {
  applyAmbassador,
  getDashboard,
  getLeaderboard,
  requestPayout,
  getPayouts,
  getMarketingAssetsStudent,
  trackAssetDownload,
  trackReferralClick
} = require('../controllers/ambassadorController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.get('/leaderboard', getLeaderboard);
router.post('/clicks', trackReferralClick);

// Protected routes (requires login)
router.use(protect);
router.post('/apply', applyAmbassador);
router.get('/dashboard', getDashboard);
router.post('/payouts', requestPayout);
router.get('/payouts', getPayouts);
router.get('/assets', getMarketingAssetsStudent);
router.post('/assets/:id/download', trackAssetDownload);

module.exports = router;
