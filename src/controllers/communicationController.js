const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const { Parser } = require('json2csv');

const EmailLog = require('../models/EmailLog');
const DeliveryLog = require('../models/DeliveryLog');
const Campaign = require('../models/Campaign');
const Broadcast = require('../models/Broadcast');
const MessageTemplate = require('../models/MessageTemplate');
const CommunicationSettings = require('../models/CommunicationSettings');
const CommunicationQueue = require('../models/CommunicationQueue');
const User = require('../models/User');
const Notification = require('../models/Notification');
const communicationService = require('../services/communicationService');
const notificationService = require('../services/notificationService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * --- OVERVIEW & STATS ---
 */
const getStats = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const [
    sentToday,
    sentThisWeek,
    totalLogs,
    deliveredCount,
    bounceCount,
    openCount,
    clickCount,
    failedCount,
    queueSize,
    scheduledCount,
    recentActivity
  ] = await Promise.all([
    EmailLog.countDocuments({ createdAt: { $gte: startOfToday } }),
    EmailLog.countDocuments({ createdAt: { $gte: startOfWeek } }),
    EmailLog.countDocuments(),
    EmailLog.countDocuments({ status: 'delivered' }),
    EmailLog.countDocuments({ status: 'bounced' }),
    EmailLog.countDocuments({ status: 'opened' }),
    EmailLog.countDocuments({ status: 'clicked' }),
    EmailLog.countDocuments({ status: 'failed' }),
    CommunicationQueue.countDocuments({ status: { $in: ['PENDING', 'PROCESSING'] } }),
    Campaign.countDocuments({ status: 'SCHEDULED' }),
    EmailLog.find()
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .limit(10)
  ]);

  const deliveryRate = totalLogs > 0 ? (deliveredCount / totalLogs) * 100 : 100;
  const bounceRate = totalLogs > 0 ? (bounceCount / totalLogs) * 100 : 0;
  const openRate = totalLogs > 0 ? (openCount / totalLogs) * 100 : 0;
  const clickRate = totalLogs > 0 ? (clickCount / totalLogs) * 100 : 0;

  const formattedActivity = (recentActivity || []).map(log => {
    let type = 'delivery';
    if (log.status === 'failed' || log.status === 'bounced') type = 'error';
    
    return {
      type,
      title: log.subject || 'System Email Sent',
      timestamp: log.createdAt || new Date(),
      description: `${log.user?.name || log.email || 'User'} - Status: ${log.status}${log.errorMessage ? ` (${log.errorMessage})` : ''}`
    };
  });

  sendSuccess(res, {
    sentToday,
    sentThisWeek,
    deliveryRate: Math.round(deliveryRate * 10) / 10,
    bounceRate: Math.round(bounceRate * 10) / 10,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    failedCount,
    queueSize,
    scheduledCount,
    recentActivity: formattedActivity
  });
});

/**
 * --- CAMPAIGNS ---
 */
const getCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await Campaign.find()
    .populate('template')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
  sendSuccess(res, campaigns);
});

const createCampaign = asyncHandler(async (req, res) => {
  const { name, templateId, content, audience, targetAudience, channels, priority, scheduledAt } = req.body;

  const rawAudience = audience || targetAudience;
  const normalizedAudience = {
    type: (rawAudience?.type || 'ALL').toUpperCase(),
    filters: rawAudience?.filters || {
      specificUserIds: rawAudience?.userIds || []
    }
  };

  const campaign = await Campaign.create({
    name,
    template: templateId || null,
    content,
    audience: normalizedAudience,
    channels: channels || ['EMAIL'],
    priority: priority || 'MEDIUM',
    scheduledAt,
    status: scheduledAt ? 'SCHEDULED' : 'SENDING',
    createdBy: req.user.id
  });

  if (!scheduledAt) {
    // Execute campaign in background via notificationService
    notificationService.executeCampaign(campaign._id).catch(err => {
      console.error('[Background Campaign Execution Error]:', err.message);
    });
  }

  sendSuccess(res, campaign, 'Campaign created and queued successfully', 201);
});

const getCampaignDetail = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id)
    .populate('template')
    .populate('createdBy', 'name email');

  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }

  const deliveryLogs = await DeliveryLog.find({ campaign: campaign._id })
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(100);

  sendSuccess(res, { campaign, deliveryLogs });
});

const sendTestCampaign = asyncHandler(async (req, res) => {
  const { templateId, content, subject } = req.body;
  const adminEmail = req.user.email;

  await communicationService.sendEmail({
    email: adminEmail,
    subject: subject || 'Campaign Test Email',
    message: content || 'This is a test notification campaign body.',
    templateName: templateId ? undefined : undefined, // Handled inside sendEmail if templateId name is passed
    userObj: { name: req.user.name, role: req.user.role }
  });

  sendSuccess(res, null, 'Test email sent successfully');
});

/**
 * --- BROADCASTS ---
 */
const getBroadcasts = asyncHandler(async (req, res) => {
  const broadcasts = await Broadcast.find()
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
  sendSuccess(res, broadcasts);
});

const createBroadcast = asyncHandler(async (req, res) => {
  const { name, message, targetGroup, filters, channels } = req.body;

  const broadcast = await Broadcast.create({
    name,
    message,
    targetGroup: targetGroup || 'ALL',
    filters: filters || {},
    channels: channels || ['EMAIL', 'APP'],
    createdBy: req.user.id,
    status: 'SENDING'
  });

  // Resolve target users
  const users = await notificationService.resolveAudience(targetGroup, filters);
  
  // Send emails and in-app notifications in background
  setImmediate(async () => {
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        if (channels.includes('APP')) {
          await notificationService.createNotification({
            user: user._id,
            title: name,
            message,
            type: 'admin'
          });
        }

        if (channels.includes('EMAIL') && user.email) {
          await communicationService.sendEmail({
            email: user.email,
            subject: name,
            message
          });
        }
        sent++;
      } catch (err) {
        failed++;
      }
    }

    broadcast.status = 'COMPLETED';
    broadcast.sentCount = sent;
    broadcast.failedCount = failed;
    await broadcast.save();
  });

  sendSuccess(res, broadcast, 'Broadcast initiated successfully', 201);
});

/**
 * --- DIRECT MESSAGES ---
 */
const searchUsers = asyncHandler(async (req, res) => {
  const { query } = req.query;
  if (!query) return sendSuccess(res, []);

  const regex = new RegExp(query, 'i');
  const users = await User.find({
    $or: [{ name: regex }, { email: regex }, { phone: regex }]
  }).select('name email phone role accountStatus').limit(20);

  sendSuccess(res, users);
});

const sendDirectMessage = asyncHandler(async (req, res) => {
  const { userId, message, channels } = req.body;

  if (!userId || !message || !channels || !Array.isArray(channels)) {
    res.status(400);
    throw new Error('Please provide a valid userId, message content, and communication channels array.');
  }

  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error('Target user not found');
  }

  if (channels.includes('APP') || channels.includes('DASHBOARD')) {
    await notificationService.createNotification({
      user: user._id,
      title: 'Direct Message from Administrator',
      message,
      type: 'admin'
    });
  }

  if (channels.includes('EMAIL') && user.email) {
    await communicationService.sendEmail({
      email: user.email,
      subject: 'Message from Relaxly Administrator',
      message
    });
  }

  sendSuccess(res, null, 'Direct message sent successfully');
});

/**
 * --- DELIVERY MONITOR ---
 */
const getDeliveryLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.search) {
    const regex = new RegExp(req.query.search, 'i');
    query.email = regex;
  }

  const [logs, total] = await Promise.all([
    EmailLog.find(query)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    EmailLog.countDocuments(query)
  ]);

  sendSuccess(res, {
    logs,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  });
});

const retryDeliveryLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await communicationService.retryEmail(id);
  sendSuccess(res, null, 'Email delivery retry initiated successfully');
});

const retryFailedCampaign = asyncHandler(async (req, res) => {
  const campaignId = req.params.id;
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }

  // 1. Find existing failed queue items
  const CommunicationQueue = mongoose.model('CommunicationQueue');
  let failedTasks = await CommunicationQueue.find({ campaign: campaignId, status: 'FAILED' });
  
  if (failedTasks.length === 0) {
    // 2. Re-create queue items from failed DeliveryLogs if they were cleaned up
    const failedLogs = await DeliveryLog.find({ campaign: campaignId, status: 'FAILED' }).populate('user');
    if (failedLogs.length === 0) {
      return sendSuccess(res, campaign, 'No failed deliveries found to retry.');
    }

    const template = campaign.template || { title: campaign.name, body: campaign.content || '' };
    const priority = campaign.priority === 'EMERGENCY' ? 10 : campaign.priority === 'CRITICAL' ? 5 : campaign.priority === 'HIGH' ? 2 : 0;
    
    const newQueueItems = failedLogs.map(log => ({
      campaign: campaignId,
      user: log.user?._id,
      channel: log.channel,
      priority,
      payload: log.channel === 'EMAIL' ? {
        email: log.user?.email || log.email,
        subject: template.title,
        body: template.body,
        userObj: { name: log.user?.name, role: log.user?.role }
      } : log.channel === 'SMS' ? {
        phone: log.user?.phone || log.phone,
        body: template.body,
        userObj: { name: log.user?.name }
      } : {
        title: template.title,
        message: template.body,
        data: { campaignId }
      }
    }));

    failedTasks = await CommunicationQueue.insertMany(newQueueItems);
  } else {
    // Reset existing failed tasks to PENDING
    for (const task of failedTasks) {
      task.status = 'PENDING';
      task.attempts = 0;
      await task.save();
    }
  }

  // Reset Campaign status back to SENDING and wipe completedAt
  campaign.status = 'SENDING';
  campaign.completedAt = undefined;
  await campaign.save();

  // Run processing in background
  const notificationService = require('../services/notificationService');
  for (const task of failedTasks) {
    setImmediate(async () => {
      try {
        await notificationService.processCommunicationTask(task._id);
      } catch (err) {
        console.error(`[Communication Background Error] Retry Task ${task._id} failed:`, err.message);
      }
    });
  }

  sendSuccess(res, campaign, 'Campaign retry for failed deliveries initiated successfully');
});

const previewAudienceCount = asyncHandler(async (req, res) => {
  const { type, filters } = req.body;
  const notificationService = require('../services/notificationService');
  const users = await notificationService.resolveAudience(type, filters);
  sendSuccess(res, { count: users.length }, 'Audience resolved successfully');
});

/**
 * --- TEMPLATES ---
 */
const getTemplates = asyncHandler(async (req, res) => {
  const templates = await MessageTemplate.find().sort({ name: 1 });
  sendSuccess(res, templates);
});

const createTemplate = asyncHandler(async (req, res) => {
  const { name, title, body, type, channels } = req.body;
  const template = await MessageTemplate.create({
    name,
    title,
    body,
    type: type || 'system',
    channels: channels || ['email'],
    createdBy: req.user.id
  });
  sendSuccess(res, template, 'Template created successfully', 201);
});

const updateTemplate = asyncHandler(async (req, res) => {
  const { title, body, type, channels } = req.body;
  const template = await MessageTemplate.findByIdAndUpdate(
    req.params.id,
    { title, body, type, channels },
    { new: true }
  );
  if (!template) {
    res.status(404);
    throw new Error('Template not found');
  }
  sendSuccess(res, template, 'Template updated successfully');
});

/**
 * --- ANALYTICS ---
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const stats = await EmailLog.aggregate([
    { $match: { createdAt: { $gte: thirtyDaysAgo } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        sent: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        opened: { $sum: { $cond: [{ $eq: ['$status', 'opened'] }, 1, 0] } },
        clicked: { $sum: { $cond: [{ $eq: ['$status', 'clicked'] }, 1, 0] } },
        bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  sendSuccess(res, stats);
});

/**
 * --- EMERGENCY ALERTS ---
 */
const createEmergencyAlert = asyncHandler(async (req, res) => {
  const { title, message } = req.body;

  if (!title || !message) {
    res.status(400);
    throw new Error('Emergency alerts require both a title and details message.');
  }

  // Broadcast to EVERY single user in system via App notification
  const users = await User.find().select('_id email');
  
  setImmediate(async () => {
    for (const user of users) {
      try {
        await notificationService.createNotification({
          user: user._id,
          title: `EMERGENCY ALERT: ${title}`,
          message,
          type: 'emergency'
        });

        if (user.email) {
          await communicationService.sendEmail({
            email: user.email,
            subject: `[EMERGENCY] ${title}`,
            message: `<strong>CRITICAL ALERT:</strong> ${message}`
          });
        }
      } catch (err) {
        console.error('Failed to dispatch alert to user:', user._id);
      }
    }
  });

  sendSuccess(res, null, 'Emergency Broadcast Alert sent successfully');
});

/**
 * --- BRAND SETTINGS ---
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await CommunicationSettings.getSettings();
  sendSuccess(res, settings);
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await CommunicationSettings.findOne();
  if (!settings) {
    const s = await CommunicationSettings.create(req.body);
    return sendSuccess(res, s, 'Branding settings updated successfully');
  }

  Object.assign(settings, req.body);
  await settings.save();
  sendSuccess(res, settings, 'Branding settings updated successfully');
});

const testResendConnection = asyncHandler(async (req, res) => {
  const start = Date.now();
  const adminEmail = req.user.email;
  
  try {
    const resData = await communicationService.sendEmail({
      email: adminEmail,
      subject: 'Resend Connection Test',
      message: 'This is a test to verify that the Resend API connection is fully functional and responsive.'
    });
    
    const latency = Date.now() - start;
    sendSuccess(res, {
      success: true,
      messageId: resData?.id,
      latency: `${latency}ms`
    }, 'Resend connection test succeeded');
  } catch (err) {
    const latency = Date.now() - start;
    res.status(500);
    throw new Error(`Resend connection test failed after ${latency}ms: ${err.message}`);
  }
});

/**
 * --- EXPORTS ---
 */
const exportLogs = asyncHandler(async (req, res) => {
  const logs = await EmailLog.find()
    .populate('user', 'name email role')
    .sort({ createdAt: -1 })
    .lean();

  const fields = [
    { label: 'Recipient Name', value: 'user.name' },
    { label: 'Recipient Email', value: 'email' },
    { label: 'Recipient Role', value: 'user.role' },
    { label: 'Subject', value: 'subject' },
    { label: 'Status', value: 'status' },
    { label: 'Sent At', value: 'sentAt' },
    { label: 'Error', value: 'errorMessage' }
  ];

  const parser = new Parser({ fields });
  const csv = parser.parse(logs);

  res.header('Content-Type', 'text/csv');
  res.attachment('communication_delivery_report.csv');
  res.send(csv);
});

/**
 * --- WEBHOOKS ---
 */
const handleResendWebhook = asyncHandler(async (req, res) => {
  // Resend webhook signature validation could go here
  const result = await communicationService.processResendWebhook(req.body);
  res.status(200).json(result);
});

module.exports = {
  getStats,
  getCampaigns,
  createCampaign,
  getCampaignDetail,
  sendTestCampaign,
  getBroadcasts,
  createBroadcast,
  searchUsers,
  sendDirectMessage,
  getDeliveryLogs,
  retryDeliveryLog,
  retryFailedCampaign,
  previewAudienceCount,
  getTemplates,
  createTemplate,
  updateTemplate,
  getAnalytics,
  createEmergencyAlert,
  getSettings,
  updateSettings,
  testResendConnection,
  exportLogs,
  handleResendWebhook
};
