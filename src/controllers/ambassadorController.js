const asyncHandler = require('express-async-handler');
const ambassadorService = require('../services/ambassadorService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

// @desc    Apply to become a campus ambassador
// @route   POST /api/ambassadors/apply
// @access  Private
const applyAmbassador = asyncHandler(async (req, res) => {
  const user = await ambassadorService.applyForAmbassador(req.user.id, req.body);
  sendSuccess(res, user, 'Ambassador application submitted successfully');
});

// @desc    Get ambassador dashboard stats and referrals
// @route   GET /api/ambassadors/dashboard
// @access  Private
const getDashboard = asyncHandler(async (req, res) => {
  try {
    const stats = await ambassadorService.getAmbassadorDashboard(req.user.id);
    sendSuccess(res, stats, 'Ambassador dashboard loaded successfully');
  } catch (error) {
    res.status(403);
    throw new Error(error.message || 'Unauthorized or application not approved');
  }
});

// @desc    Get ambassador leaderboard
// @route   GET /api/ambassadors/leaderboard
// @access  Public
const getLeaderboard = asyncHandler(async (req, res) => {
  const rank = await ambassadorService.getAmbassadorLeaderboard();
  sendSuccess(res, rank, 'Ambassador leaderboard loaded successfully');
});

const requestPayout = asyncHandler(async (req, res) => {
  const { amount, paymentMethod, paymentDetails } = req.body;
  if (!amount || !paymentMethod || !paymentDetails) {
    res.status(400);
    throw new Error('Please provide payout amount, method, and payment details.');
  }

  const payout = await ambassadorService.requestPayout(req.user.id, amount, paymentMethod, paymentDetails);
  sendSuccess(res, payout, 'Payout request submitted successfully', 201);
});

const getPayouts = asyncHandler(async (req, res) => {
  const payouts = await ambassadorService.getPayoutsForUser(req.user.id);
  sendSuccess(res, payouts, 'Payout history retrieved successfully');
});

const getMarketingAssetsStudent = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const MarketingAsset = require('../models/MarketingAsset');

  const user = await User.findById(req.user.id);
  if (!user || user.ambassadorStatus !== 'approved') {
    res.status(403);
    throw new Error('Ambassador access restricted');
  }

  // Auto-archive expired assets
  const now = new Date();
  await MarketingAsset.updateMany(
    { status: 'published', expiryDate: { $lt: now } },
    { $set: { status: 'archived' } }
  );

  const university = user.ambassadorProfile?.university;
  const badge = user.ambassadorProfile?.badge || 'bronze';

  const assets = await MarketingAsset.find({ status: 'published' })
    .select('-downloads') // Exclude download details for basic directory load
    .sort({ createdAt: -1 });

  const eligibleAssets = assets.filter(asset => {
    const matchesUni = !asset.targetUniversities || asset.targetUniversities.length === 0 || 
      (university && asset.targetUniversities.some(u => u.toLowerCase() === university.toLowerCase()));
      
    const matchesBadge = !asset.targetBadges || asset.targetBadges.length === 0 || 
      asset.targetBadges.some(b => b.toLowerCase() === badge.toLowerCase());

    console.log('[DEBUG] Student Ambassador Target Checks:', {
      'Ambassador University': university,
      'Ambassador Badge': badge,
      'Asset Title': asset.title,
      'Asset Universities': asset.targetUniversities,
      'Asset Badges': asset.targetBadges,
      'Asset Status': asset.status,
      'Asset Expiry': asset.expiryDate,
      'Match Result': matchesUni && matchesBadge
    });

    return matchesUni && matchesBadge;
  });

  sendSuccess(res, eligibleAssets, 'Promotional assets loaded successfully');
});

const trackAssetDownload = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  const { id } = req.params;

  const asset = await MarketingAsset.findById(id);
  if (!asset || asset.status !== 'published') {
    res.status(404);
    throw new Error('Marketing asset not found');
  }

  // Check if this is the user's first download of this asset
  const hasDownloadedBefore = asset.downloads.some(d => d.user && d.user.toString() === req.user.id);
  const isFirstDownload = !hasDownloadedBefore;

  asset.downloadsCount += 1;
  if (isFirstDownload) {
    asset.uniqueDownloadsCount += 1;
  }
  
  asset.downloads.push({
    user: req.user.id,
    downloadedAt: new Date(),
    isFirstDownload
  });

  await asset.save();

  sendSuccess(res, { 
    downloadsCount: asset.downloadsCount,
    uniqueDownloadsCount: asset.uniqueDownloadsCount
  }, 'Download tracked successfully');
});

const parseUserAgent = (uaString) => {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (!uaString) return { browser, os, device };

  if (uaString.includes('Firefox')) browser = 'Firefox';
  else if (uaString.includes('Chrome')) browser = 'Chrome';
  else if (uaString.includes('Safari')) browser = 'Safari';
  else if (uaString.includes('Edge')) browser = 'Edge';
  else if (uaString.includes('Opera') || uaString.includes('OPR')) browser = 'Opera';

  if (uaString.includes('Windows')) os = 'Windows';
  else if (uaString.includes('Macintosh') || uaString.includes('Mac OS')) os = 'macOS';
  else if (uaString.includes('Linux')) os = 'Linux';
  else if (uaString.includes('Android')) os = 'Android';
  else if (uaString.includes('iPhone') || uaString.includes('iPad')) os = 'iOS';

  if (/Mobi|Android|iPhone|iPad|BlackBerry|IEMobile|Opera Mini/i.test(uaString)) {
    device = 'Mobile';
  }

  return { browser, os, device };
};

// @desc    Track a referral link click
// @route   POST /api/ambassadors/clicks
// @access  Public
const trackReferralClick = asyncHandler(async (req, res) => {
  const ReferralClick = require('../models/ReferralClick');
  const User = require('../models/User');
  const { referralCode, clickType = 'click', source = 'link', campaignId, assetId } = req.body;

  if (!referralCode) {
    res.status(400);
    throw new Error('Referral code is required.');
  }

  const ambassador = await User.findOne({ 
    'ambassadorProfile.referralCode': referralCode.trim(),
    ambassadorStatus: 'approved'
  });

  if (!ambassador) {
    res.status(404);
    throw new Error('Referral code is invalid or not active.');
  }

  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  // 1. Abuse Protection: Prevent duplicate click inflation (same refCode, same IP, same type/source within 30 mins)
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const duplicateClick = await ReferralClick.findOne({
    referralCode: referralCode.trim(),
    ipAddress,
    clickType,
    source,
    timestamp: { $gte: thirtyMinutesAgo }
  });

  if (duplicateClick) {
    return sendSuccess(res, duplicateClick, 'Duplicate click recorded within 30 minutes; ignored for analytics accuracy');
  }

  const { browser, os, device } = parseUserAgent(userAgent);
  
  // 2. Geolocation parsing using Cloudflare/hosting headers, mapping to full country names
  const countryCode = req.headers['cf-ipcountry'] || req.headers['x-appengine-country'] || req.headers['x-forwarded-country'] || 'GH';
  const countryNames = {
    'GH': 'Ghana',
    'NG': 'Nigeria',
    'KE': 'Kenya',
    'ZA': 'South Africa',
    'US': 'United States',
    'GB': 'United Kingdom'
  };
  const country = countryNames[countryCode.toUpperCase()] || 'Ghana';

  const mongoose = require('mongoose');
  const cleanCampaignId = campaignId && mongoose.Types.ObjectId.isValid(campaignId) ? campaignId : undefined;
  const cleanAssetId = assetId && mongoose.Types.ObjectId.isValid(assetId) ? assetId : undefined;

  const click = await ReferralClick.create({
    referralCode: referralCode.trim(),
    ipAddress,
    userAgent,
    browser,
    os,
    device,
    country,
    clickType,
    source,
    campaignId: cleanCampaignId,
    assetId: cleanAssetId
  });

  const logger = require('../utils/logger');
  logger.info(`[REFERRAL_CLICK] Code: ${referralCode.trim()}, IP: ${ipAddress}, Type: ${clickType}, Source: ${source}`);

  sendSuccess(res, click, 'Referral click recorded successfully');
});

module.exports = {
  applyAmbassador,
  getDashboard,
  getLeaderboard,
  requestPayout,
  getPayouts,
  getMarketingAssetsStudent,
  trackAssetDownload,
  trackReferralClick
};
