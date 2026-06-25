const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const DeliveryLog = require('../models/DeliveryLog');
const EmailLog = require('../models/EmailLog');
const SmsLog = require('../models/SmsLog');
const CommunicationQueue = require('../models/CommunicationQueue');
const MessageTemplate = require('../models/MessageTemplate');
const socketManager = require('../utils/socketManager');
const sendEmail = require('../utils/sendEmail');
const smsService = require('../utils/smsService');

const compileTemplate = (body, userObj) => {
  if (!userObj) userObj = {};
  return body.replace(/{{name}}/g, userObj.name || 'User')
             .replace(/{{email}}/g, userObj.email || '')
             .replace(/{{role}}/g, userObj.role || '');
};

const processCommunicationTask = async (taskId) => {
  const task = await CommunicationQueue.findById(taskId);
  if (!task) return;

  // Prevent duplicate execution
  if (task.status === 'PROCESSING' || task.status === 'COMPLETED') return;

  task.status = 'PROCESSING';
  await task.save();

  try {
    let result;
    const { payload, user, campaign } = task;

    if (task.channel === 'APP') {
      result = await notificationService.createNotification({
        user, title: payload.title, message: payload.message, type: 'admin', data: payload.data
      });
      await DeliveryLog.create({ campaign, user, channel: 'APP', status: 'DELIVERED', sentAt: new Date() });
    } else if (task.channel === 'EMAIL') {
      const body = compileTemplate(payload.body, payload.userObj);
      
      let emailLog = await EmailLog.create({ campaign, user, email: payload.email, subject: payload.subject, status: 'PENDING' });
      const trackingPixel = `<img src="${process.env.APP_URL || 'http://localhost:5000'}/api/notifications/track/email/${emailLog._id}" width="1" height="1" />`;
      const finalBody = body + trackingPixel;

      result = await sendEmail({ email: payload.email, subject: payload.subject, message: finalBody });
      
      emailLog.status = 'SENT';
      emailLog.sentAt = new Date();
      emailLog.messageId = result.messageId;
      await emailLog.save();
      await DeliveryLog.create({ campaign, user, channel: 'EMAIL', status: 'SENT', sentAt: new Date() });
    } else if (task.channel === 'SMS') {
      const body = compileTemplate(payload.body, payload.userObj);
      let smsLog = await SmsLog.create({ campaign, user, phone: payload.phone, message: body, status: 'PENDING' });
      
      result = await smsService.sendSMS({ to: payload.phone, message: body });
      
      smsLog.status = 'SENT';
      smsLog.sentAt = new Date();
      smsLog.messageId = result.messageId;
      await smsLog.save();
      await DeliveryLog.create({ campaign, user, channel: 'SMS', status: 'SENT', sentAt: new Date() });
    }

    task.status = 'COMPLETED';
    await task.save();
    
    if (task.campaign) {
      await notificationService._updateCampaignStats(task.campaign);
    }
  } catch (error) {
    task.attempts += 1;
    task.errorLogs.push(error.message);
    task.status = 'FAILED';
    await task.save();
    
    await DeliveryLog.create({ 
      campaign: task.campaign, 
      user: task.user, 
      channel: task.channel, 
      status: 'FAILED', 
      errorMessage: error.message, 
      sentAt: new Date() 
    });

    throw error;
  }
};

const notificationService = {
  createNotification: async ({ user, title, message, type = 'system', data = {} }) => {
    if (!user || !message) return null;
    const notification = await Notification.create({ user, title, message, type, data });
    
    // Emit both events for maximum compatibility with different frontend versions
    socketManager.notifyUser(user, 'notification_received', notification);
    socketManager.notifyUser(user, 'notification', {
      title,
      message,
      type,
      data,
      createdAt: notification.createdAt
    });

    return notification;
  },

  createNotifications: async (notifications) => {
    if (!Array.isArray(notifications)) return [];
    return Promise.all(notifications.map(n => notificationService.createNotification(n)));
  },

  resolveAudience: async (audienceType, filters = {}) => {
    let query = {};
    const type = String(audienceType).toUpperCase();
    
    switch (type) {
      case 'STUDENTS': query.role = 'student'; break;
      case 'OWNERS': query.role = 'owner'; break;
      case 'SPECIFIC_USERS': 
      case 'DIRECT':
        query._id = { $in: filters.specificUserIds }; break;
      case 'SEGMENT':
        if (filters.university) query.university = filters.university;
        if (filters.verificationStatus) query.accountStatus = filters.verificationStatus;
        break;
      case 'ALL': default: break;
    }
    return User.find(query).select('name email phone role');
  },

  executeCampaign: async (campaignId) => {
    const campaign = await Campaign.findById(campaignId).populate('template');
    if (!campaign || campaign.status === 'COMPLETED') return;

    campaign.status = 'SENDING';
    campaign.sentAt = new Date();
    await campaign.save();

    const users = await notificationService.resolveAudience(campaign.audience.type, campaign.audience.filters);
    campaign.stats.targetCount = users.length;
    await campaign.save();

    const template = campaign.template || { title: campaign.name, body: campaign.content || '' };
    const priority = campaign.priority === 'EMERGENCY' ? 10 : campaign.priority === 'CRITICAL' ? 5 : campaign.priority === 'HIGH' ? 2 : 0;

    const queueItems = [];

    if (campaign.priority === 'EMERGENCY') {
        socketManager.notifyAdmins('emergency_alert', { title: template.title, message: template.body });
        socketManager.io.emit('emergency_alert', { title: template.title, message: template.body });
    }

    const channels = campaign.channels.map(c => String(c).toUpperCase());

    for (const user of users) {
      if (channels.includes('DASHBOARD') || channels.includes('APP')) {
        queueItems.push({
          campaign: campaign._id, user: user._id, channel: 'APP', priority,
          payload: { title: template.title, message: template.body, data: { campaignId: campaign._id } }
        });
      }
      if (channels.includes('EMAIL') && user.email) {
        queueItems.push({
          campaign: campaign._id, user: user._id, channel: 'EMAIL', priority,
          payload: { email: user.email, subject: template.title, body: template.body, userObj: { name: user.name, role: user.role } }
        });
      }
      if (channels.includes('SMS') && user.phone) {
        queueItems.push({
          campaign: campaign._id, user: user._id, channel: 'SMS', priority,
          payload: { phone: user.phone, body: template.body, userObj: { name: user.name } }
        });
      }
    }

    if (queueItems.length > 0) {
      const docs = await CommunicationQueue.insertMany(queueItems);
      for (const doc of docs) {
        setImmediate(async () => {
          try {
            await processCommunicationTask(doc._id);
          } catch (err) {
            console.error(`[Communication Background Error] Task ${doc._id} failed:`, err.message);
          }
        });
      }
    }
  },

  sendDirectMessage: async (adminId, userId, message, channels) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error('Invalid User ID format');
    }

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      throw new Error('No communication channels specified');
    }

    const normalizedChannels = channels.map(c => String(c).toUpperCase());

    const queueItems = [];
    if (normalizedChannels.includes('DASHBOARD') || normalizedChannels.includes('APP')) {
      queueItems.push({
        user: user._id,
        channel: 'APP',
        priority: 5,
        payload: { title: 'Direct Message', message, data: { from: adminId } }
      });
    }
    if (normalizedChannels.includes('EMAIL') && user.email) {
      queueItems.push({
        user: user._id,
        channel: 'EMAIL',
        priority: 5,
        payload: { email: user.email, subject: 'Direct Message from Admin', body: message, userObj: { name: user.name, role: user.role } }
      });
    }
    if (normalizedChannels.includes('SMS') && user.phone) {
      queueItems.push({
        user: user._id,
        channel: 'SMS',
        priority: 5,
        payload: { phone: user.phone, body: message, userObj: { name: user.name } }
      });
    }

    if (queueItems.length > 0) {
      const docs = await CommunicationQueue.insertMany(queueItems);
      for (const doc of docs) {
        setImmediate(async () => {
          try {
            await processCommunicationTask(doc._id);
          } catch (err) {
            console.error(`[Communication Background Error] Task ${doc._id} failed:`, err.message);
          }
        });
      }
    }
    return { success: true, queuedCount: queueItems.length };
  },

  _updateCampaignStats: async (campaignId) => {
    const logs = await DeliveryLog.find({ campaign: campaignId });
    const stats = {
      sentCount: logs.filter(l => ['SENT', 'DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      deliveredCount: logs.filter(l => ['DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      failedCount: logs.filter(l => l.status === 'FAILED').length
    };
    await Campaign.findByIdAndUpdate(campaignId, {
      'stats.sentCount': stats.sentCount,
      'stats.deliveredCount': stats.deliveredCount,
      'stats.failedCount': stats.failedCount
    });
  }
};

module.exports = notificationService;
