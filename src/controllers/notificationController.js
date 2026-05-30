const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Notification = require('../models/Notification');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const MessageTemplate = require('../models/MessageTemplate');
const DeliveryLog = require('../models/DeliveryLog');
const EmailLog = require('../models/EmailLog');
const SmsLog = require('../models/SmsLog');
const communicationService = require('../services/notificationService');
const { sendSuccess } = require('../utils/responseHandler');
const { Parser } = require('json2csv');

// --- USER NOTIFICATIONS ---

const getNotifications = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { user: req.user.id };
    if (req.query.read !== undefined) filter.read = req.query.read === 'true';

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user.id, read: false }),
    ]);

    sendSuccess(res, {
      notifications,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      unreadCount
    });
});

const markAsRead = asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) {
      res.status(404);
      throw new Error('Notification not found');
    }
    sendSuccess(res, notification, 'Marked as read');
});

const markAllAsRead = asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true, readAt: new Date() });
    sendSuccess(res, null, 'All notifications marked as read');
});

const getUnreadCount = asyncHandler(async (req, res) => {
  if (!req.user?.id) {
    return sendSuccess(res, { count: 0 });
  }
  const count = await Notification.countDocuments({ user: req.user.id, read: false });
  sendSuccess(res, { count });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }
  sendSuccess(res, null, 'Notification deleted');
});

// --- TRACKING ---

const trackEmailOpen = asyncHandler(async (req, res) => {
  const { id } = req.params;
  try {
    await EmailLog.findByIdAndUpdate(id, { 
      status: 'opened', 
      openedAt: new Date() 
    });
  } catch (e) {
    // Ignore errors for pixel tracking
  }

  // Return a 1x1 transparent GIF
  const buf = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set('Content-Type', 'image/gif');
  res.send(buf);
});

// --- ADMIN BROADCAST CENTER ---

const getCommunicationStats = asyncHandler(async (req, res) => {
  const [totalSentToday, deliveryStats] = await Promise.all([
    DeliveryLog.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
    DeliveryLog.aggregate([
      { $group: { _id: '$channel', total: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } } } }
    ])
  ]);

  const activeCampaigns = await Campaign.find({ status: 'sending' }).countDocuments();

  sendSuccess(res, {
    totalSentToday,
    channels: deliveryStats,
    activeCampaigns
  });
});

const createCampaign = asyncHandler(async (req, res) => {
  try {
    const { name, templateId, audience, targetAudience, channels, priority, scheduledAt, content } = req.body;

    // Normalization Layer
    const normalizedPriority = priority ? String(priority).toUpperCase() : 'MEDIUM';
    const normalizedChannels = Array.isArray(channels) 
      ? channels.map(c => String(c).toUpperCase().replace('DASHBOARD', 'APP')) // Alias DASHBOARD to APP
      : [];
    
    // Support 'targetAudience' (frontend) and 'audience' (backend)
    const rawAudience = audience || targetAudience;
    const normalizedAudience = {
      type: (rawAudience?.type || 'ALL').toUpperCase(),
      filters: rawAudience?.filters || {
        specificUserIds: rawAudience?.userIds || []
      }
    };

    // If it's a direct message (individual), set type to DIRECT
    if (normalizedAudience.type === 'INDIVIDUAL' || normalizedAudience.type === 'SPECIFIC_USERS') {
      normalizedAudience.type = 'DIRECT';
    }

    const campaign = await Campaign.create({
      name,
      template: templateId,
      content, // For direct messages without templates
      audience: normalizedAudience,
      channels: normalizedChannels,
      priority: normalizedPriority,
      scheduledAt,
      status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
      createdBy: req.user.id
    });

    if (!scheduledAt) {
      communicationService.executeCampaign(campaign._id).catch(err => {
        console.error("CAMPAIGN EXECUTION ERROR:", err.message);
      });
    }

    sendSuccess(res, campaign, 'Campaign created', 201);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400);
      const message = Object.values(error.errors).map(val => val.message).join(', ');
      throw new Error(`Campaign validation failed: ${message}`);
    }
    throw error;
  }
});

const getCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await Campaign.find().populate('template').sort({ createdAt: -1 });
  sendSuccess(res, campaigns);
});

const getCampaignDetail = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).populate('template');
  const deliveryLogs = await DeliveryLog.find({ campaign: req.params.id }).populate('user', 'name email').limit(100);        
  sendSuccess(res, { campaign, deliveryLogs });
});

// --- TEMPLATE MANAGEMENT ---

const getTemplates = asyncHandler(async (req, res) => {
  const templates = await MessageTemplate.find().sort({ name: 1 });
  sendSuccess(res, templates);
});

const createTemplate = asyncHandler(async (req, res) => {
  const template = await MessageTemplate.create({ ...req.body, createdBy: req.user.id });
  sendSuccess(res, template, 'Template created', 201);
});

// --- AUDIENCE SEGMENTATION & TARGETING ---

const previewAudienceCount = asyncHandler(async (req, res) => {
  const { type, filters } = req.body;
  const users = await communicationService.resolveAudience(type, filters);
  sendSuccess(res, { count: users.length });
});

const searchUsersForMessaging = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const regex = new RegExp(query, 'i');
  const users = await User.find({
    $or: [{ name: regex }, { email: regex }, { phone: regex }]
  }).select('name email phone role').limit(20);
  sendSuccess(res, users);
});

const sendDirectMessage = asyncHandler(async (req, res) => {
  try {
    const { userId, message, channels } = req.body;
    
    if (!userId || !message || !channels || !Array.isArray(channels)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: userId, message, and channels (array) are required'
      });
    }

    await communicationService.sendDirectMessage(req.user.id, userId, message, channels);
    
    sendSuccess(res, null, 'Direct message queued for delivery');
  } catch (error) {
    console.error("DIRECT MESSAGE ERROR:", error);
    
    res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
});

// --- EXPORT & REPORTS ---

const exportCampaignReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const logs = await DeliveryLog.find({ campaign: id }).populate('user', 'name email').lean();

  const fields = ['user.name', 'user.email', 'channel', 'status', 'errorMessage', 'sentAt'];
  const json2csvParser = new Parser({ fields });
  const csv = json2csvParser.parse(logs);

  res.header('Content-Type', 'text/csv');
  res.attachment(`campaign_${id}_report.csv`);
  res.send(csv);
});

module.exports = {
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  trackEmailOpen,
  getCommunicationStats,
  createCampaign,
  getCampaigns,
  getCampaignDetail,
  getTemplates,
  createTemplate,
  previewAudienceCount,
  searchUsersForMessaging,
  sendDirectMessage,
  exportCampaignReport
};
