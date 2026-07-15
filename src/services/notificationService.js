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
const communicationService = require('./communicationService');
const emailService = require('./emailService');
const NotificationMetric = require('../models/NotificationMetric');
const { BACKEND_URL } = require('../config/appConfig');

const mapAdminRoleToUserRole = (role) => {
  switch (role) {
    case 'finance_admin':
    case 'moderator':
    case 'super_admin':
    case 'support_admin':
    case 'marketing_admin':
      return role;
    default:
      return role;
  }
};

const buildApprovalEmailBody = ({ title, message, actionUrl, actionLabel = 'Review Request' }) => {
  const safeMessage = String(message || '').replace(/\n/g, '<br />');
  const cta = actionUrl
    ? `<p style="margin: 28px 0;"><a href="${actionUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 18px; border-radius: 8px; text-decoration: none; font-weight: 700;">${actionLabel}</a></p>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 16px; color: #111827;">${title}</h2>
      <p>${safeMessage}</p>
      ${cta}
      <p style="color: #6b7280; font-size: 13px;">Relaxly Admin Notifications</p>
    </div>
  `;
};

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
  task.lastAttempt = new Date();
  await task.save();

  try {
    let result;
    const { payload, user, campaign } = task;

    if (task.channel === 'APP') {
      result = await notificationService.createNotification({
        user,
        title: payload.title,
        message: payload.message,
        type: 'admin',
        severity: payload.severity || 'info',
        auditId: payload.auditId,
        data: payload.data
      });
      await DeliveryLog.create({ campaign, user, channel: 'APP', status: 'DELIVERED', sentAt: new Date() });
    } else if (task.channel === 'EMAIL') {
      const body = compileTemplate(payload.body, payload.userObj);
      
      let emailLog = await EmailLog.create({ campaign, user, email: payload.email, subject: payload.subject, status: 'pending' });
      const trackingPixel = `<img src="${BACKEND_URL}/api/notifications/track/email/${emailLog._id}" width="1" height="1" />`;
      const finalBody = body + trackingPixel;

      result = await emailService.sendEmail({
        email: payload.email,
        subject: payload.subject,
        html: finalBody
      });
      
      emailLog.status = 'sent';
      emailLog.sentAt = new Date();
      emailLog.messageId = result?.id;
      await emailLog.save();
      await DeliveryLog.create({ campaign, user, channel: 'EMAIL', status: 'SENT', sentAt: new Date(), referenceId: result?.id });
    } else if (task.channel === 'SMS') {
      const body = compileTemplate(payload.body, payload.userObj);
      let smsLog = await SmsLog.create({ campaign, user, phone: payload.phone, message: body, status: 'pending' });
      
      result = await smsService.sendSMS({ to: payload.phone, message: body });
      
      smsLog.status = 'sent';
      smsLog.sentAt = new Date();
      smsLog.messageId = result.messageId;
      await smsLog.save();
      await DeliveryLog.create({ campaign, user, channel: 'SMS', status: 'SENT', sentAt: new Date(), referenceId: result.messageId });
    }

    task.status = 'COMPLETED';
    await task.save();
    
    if (task.campaign) {
      await notificationService._updateCampaignStats(task.campaign);
    }
  } catch (error) {
    task.attempts += 1;
    task.lastAttempt = new Date();
    task.failureReason = error.message;
    task.errorLogs.push(error.message);
    
    if (task.attempts < task.maxAttempts) {
      task.status = 'PENDING';
      const backoffMinutes = Math.pow(2, task.attempts);
      task.nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      task.nextRetry = task.nextAttemptAt;
    } else {
      task.status = 'FAILED';
    }
    await task.save();
    
    await DeliveryLog.create({ 
      campaign: task.campaign, 
      user: task.user, 
      channel: task.channel, 
      status: 'FAILED', 
      errorMessage: error.message, 
      sentAt: new Date() 
    });

    if (task.campaign) {
      try {
        await notificationService._updateCampaignStats(task.campaign);
      } catch (statsErr) {
        console.error('Failed to update stats on task failure:', statsErr.message);
      }
    }

    // Alert super admins of permanent failure
    if (task.status === 'FAILED') {
      try {
        const socketManager = require('../utils/socketManager');
        const alertMsg = `Permanent communication failure for user ${task.user} on channel ${task.channel} after ${task.attempts} attempts. Error: ${error.message}`;
        const superAdmins = await User.find({ role: 'super_admin' }).select('_id');
        for (const admin of superAdmins) {
          await notificationService.createNotification({
            user: admin._id,
            title: 'Critical Comm Failure',
            message: alertMsg,
            type: 'system',
            severity: 'critical'
          });
          socketManager.notifyUser(admin._id, 'notification_received', { title: 'Critical Comm Failure', message: alertMsg });
        }
      } catch (notifyErr) {
        console.error('Failed to notify admins of permanent comm failure:', notifyErr.message);
      }
    }

    throw error;
  }
};

const notificationService = {
  createNotification: async ({ user, title, message, type = 'system', severity = 'info', auditId, data = {}, notificationKey }, session) => {
    if (!user || !message) return null;
    const payload = { user, title, message, type, severity, auditId, data };
    if (notificationKey) {
      const existing = await Notification.findOne({ user, notificationKey }).session(session);
      if (existing) {
        existing.wasDuplicate = true;
        try {
          await NotificationMetric.updateOne({ key: 'skipped_duplicates' }, { $inc: { value: 1 } }, { upsert: true });
        } catch (metricErr) {
          console.error('Failed to increment skipped duplicate metric:', metricErr.message);
        }
        return existing;
      }
      payload.notificationKey = notificationKey;
    }

    let notification;
    try {
      if (session) {
        const [newNotif] = await Notification.create([payload], { session });
        notification = newNotif;
      } else {
        notification = await Notification.create(payload);
      }
    } catch (err) {
      if (err.code === 11000 && notificationKey) {
        notification = await Notification.findOne({ user, notificationKey }).session(session);
        if (notification) {
          notification.wasDuplicate = true;
          try {
            await NotificationMetric.updateOne({ key: 'skipped_duplicates' }, { $inc: { value: 1 } }, { upsert: true });
          } catch (metricErr) {
            console.error('Failed to increment skipped duplicate metric on clash:', metricErr.message);
          }
          return notification;
        }
      }
      throw err;
    }
    
    // Emit both events for maximum compatibility with different frontend versions
    socketManager.notifyUser(user, 'notification_received', notification);
    socketManager.notifyUser(user, 'notification', {
      title,
      message,
      type,
      severity,
      auditId,
      data,
      createdAt: notification.createdAt
    });

    return notification;
  },

  createNotifications: async (notifications, session) => {
    if (!Array.isArray(notifications)) return [];
    return Promise.all(notifications.map(n => notificationService.createNotification(n, session)));
  },

  notifyAdmins: async ({
    role,
    roles,
    title,
    message,
    subject,
    emailBody,
    emailTemplate,
    idempotencyKey,
    workflow,
    entityId,
    status,
    actionUrl,
    actionLabel,
    type = 'system',
    severity = 'info',
    auditId,
    data = {},
    includeSuperAdmins = true
  }, session) => {
    if (!title || !message) return { notifiedCount: 0, emailFailures: 0, skippedDuplicates: 0 };

    const requestedRoles = roles || (role ? [role] : []);
    const userRoles = requestedRoles.map(mapAdminRoleToUserRole);
    const notificationKey = idempotencyKey || data.notificationKey || (
      workflow && entityId && status ? `${workflow}:${entityId}:${status}` : null
    );

    if (includeSuperAdmins && !userRoles.includes('super_admin')) {
      userRoles.push('super_admin');
    }

    const admins = await User.find({
      role: { $in: [...new Set(userRoles)] },
      accountStatus: 'active'
    }).select('name email role adminNotificationPreferences').session(session);

    if (admins.length === 0) {
      console.warn(`[NotificationService.notifyAdmins] No active admins found for roles: ${requestedRoles.join(', ')}`);
      return { notifiedCount: 0, emailFailures: 0, skippedDuplicates: 0 };
    }

    const html = emailBody || buildApprovalEmailBody({
      title,
      message,
      actionUrl,
      actionLabel
    });

    let emailFailures = 0;
    let skippedDuplicates = 0;

    for (const admin of admins) {
      let notification;
      const wantsInApp = admin.adminNotificationPreferences?.inApp !== false;
      const wantsEmail = admin.adminNotificationPreferences?.email !== false;

      if (wantsInApp) {
        try {
          notification = await notificationService.createNotification({
            user: admin._id,
            title,
            message,
            type,
            severity,
            auditId,
            data,
            notificationKey
          }, session);
        } catch (err) {
          console.error(`[NotificationService.notifyAdmins] In-app notification failed for ${admin._id}:`, err.message);
        }
      }

      if (notification?.wasDuplicate) {
        skippedDuplicates += 1;
        continue;
      }

      if (!wantsEmail || !admin.email) continue;

      // Digest new hostels registration emails to avoid cluttering inboxes
      if (workflow === 'hostel_moderation') {
        continue;
      }

      try {
        // Create a queued communication task inside the session if it exists
        const [commTask] = await CommunicationQueue.create([{
          user: admin._id,
          channel: 'EMAIL',
          priority: 5,
          payload: {
            email: admin.email,
            subject: subject || title,
            body: html,
            templateName: emailTemplate,
            userObj: { name: admin.name, role: admin.role },
            severity,
            auditId
          }
        }], session ? { session } : {});

        // Process queue task outside transaction
        const docId = commTask._id;
        setImmediate(async () => {
          try {
            await processCommunicationTask(docId);
          } catch (err) {
            console.error(`[Communication Queue Error] Background task ${docId} failed:`, err.message);
          }
        });
      } catch (err) {
        emailFailures += 1;
        console.error(`[NotificationService.notifyAdmins] Queueing email failed for ${admin.email}:`, err.message);
      }
    }

    return { notifiedCount: admins.length, emailFailures, skippedDuplicates };
  },

  resolveAudience: async (audienceType, filters = {}) => {
    let query = { accountStatus: 'active' };
    const type = String(audienceType).toUpperCase();
    
    switch (type) {
      case 'STUDENTS': 
        query.role = 'student'; 
        break;
      case 'OWNERS': 
        query.role = 'owner'; 
        break;
      case 'SPECIFIC_USERS': 
      case 'DIRECT':
        query._id = { $in: filters.specificUserIds || [] }; 
        break;
      case 'SEGMENT':
        // 1. Role Filter
        if (filters.role && filters.role !== 'all') {
          if (filters.role === 'ambassador') {
            query.isAmbassador = true;
          } else {
            query.role = filters.role;
          }
        }
        // 2. University Filter
        if (filters.university && filters.university !== 'all') {
          query.university = filters.university;
        }
        // 3. Verification Filter
        if (filters.verifiedOnly === true || filters.verifiedOnly === 'true') {
          if (query.role === 'student') {
            query.isStudentVerified = true;
          } else if (query.role === 'owner') {
            query.isOwnerVerified = true;
          } else {
            query.$or = [{ isStudentVerified: true }, { isOwnerVerified: true }];
          }
        }
        break;
      case 'ALL': 
      default: 
        break;
    }
    return User.find(query).select('name email phone role');
  },

  executeCampaign: async (campaignId) => {
    const campaign = await Campaign.findById(campaignId).populate('template');
    if (!campaign || ['COMPLETED', 'FAILED', 'COMPLETED_WITH_ERRORS'].includes(campaign.status)) return;

    // 1. Resolve audience size first
    let users = [];
    try {
      users = await notificationService.resolveAudience(campaign.audience.type, campaign.audience.filters);
    } catch (resolveErr) {
      campaign.status = 'FAILED';
      campaign.failureReason = `Failed to resolve target audience: ${resolveErr.message}`;
      campaign.completedAt = new Date();
      await campaign.save();
      return;
    }

    campaign.stats.targetCount = users.length;

    // 2. Handle empty audience
    if (users.length === 0) {
      campaign.status = 'FAILED';
      campaign.failureReason = 'No users matched target audience filters';
      campaign.completedAt = new Date();
      await campaign.save();
      return;
    }

    // 3. Mark sending and execute queueing
    campaign.status = 'SENDING';
    campaign.sentAt = new Date();
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
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;

    // Fetch related logs and queue items
    const [logs, processingCount] = await Promise.all([
      DeliveryLog.find({ campaign: campaignId }),
      CommunicationQueue.countDocuments({ campaign: campaignId, status: { $in: ['PENDING', 'PROCESSING'] } })
    ]);

    const stats = {
      sentCount: logs.filter(l => ['SENT', 'DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      deliveredCount: logs.filter(l => ['DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      failedCount: logs.filter(l => l.status === 'FAILED').length
    };

    const targetCount = campaign.stats.targetCount || 0;
    const processed = stats.sentCount + stats.failedCount;

    // Compute percentages
    const totalDenom = targetCount || processed || 1;
    const deliveryPercentage = Math.round((stats.deliveredCount / totalDenom) * 1000) / 10;
    const failurePercentage = Math.round((stats.failedCount / totalDenom) * 1000) / 10;

    let updateData = {
      'stats.sentCount': stats.sentCount,
      'stats.processingCount': processingCount,
      'stats.deliveredCount': stats.deliveredCount,
      'stats.failedCount': stats.failedCount,
      'stats.deliveryPercentage': deliveryPercentage,
      'stats.failurePercentage': failurePercentage
    };

    if (targetCount > 0 && processed >= targetCount && campaign.status === 'SENDING') {
      if (stats.sentCount === 0) {
        updateData.status = 'FAILED';
      } else if (stats.failedCount > 0) {
        updateData.status = 'COMPLETED_WITH_ERRORS';
      } else {
        updateData.status = 'COMPLETED';
      }
      updateData.completedAt = new Date();
    }

    await Campaign.findByIdAndUpdate(campaignId, updateData);
  },

  sendHostelModerationDigest: async () => {
    try {
      const Hostel = require('../models/Hostel');
      // Find all hostels registered in the last hour that are still pending verification
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const pendingHostels = await Hostel.find({
        verificationStatus: 'pending',
        createdAt: { $gte: oneHourAgo }
      }).populate('owner', 'name email');

      if (pendingHostels.length === 0) {
        console.log('[Hostel Digest] No new hostels pending moderation in the last hour.');
        return;
      }

      const count = pendingHostels.length;
      const subject = `${count} Hostel${count > 1 ? 's' : ''} Awaiting Moderation`;
      
      let hostelListHtml = '';
      for (const hostel of pendingHostels) {
        hostelListHtml += `
          <li style="margin-bottom: 12px; padding: 12px; border: 1px solid #f1f5f9; border-radius: 8px;">
            <strong>${hostel.name}</strong><br />
            Location: ${hostel.location?.city || 'Unspecified'}<br />
            Owner: ${hostel.owner?.name || 'Unknown'} (${hostel.owner?.email || 'N/A'})
          </li>
        `;
      }

      const reviewUrl = buildAdminUrl('/hostels');
      const emailBody = `
        <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
          <h2 style="margin: 0 0 16px; color: #111827;">${subject}</h2>
          <p>Hello,</p>
          <p>The following hostels were submitted in the last hour and are awaiting verification:</p>
          <ul style="padding-left: 20px; list-style-type: none;">
            ${hostelListHtml}
          </ul>
          <div style="margin: 28px 0;">
            ${reviewUrl ? `<a href="${reviewUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block;">Moderate Hostels</a>` : ''}
          </div>
          <p style="color: #6b7280; font-size: 13px;">Relaxly Admin Notifications</p>
        </div>
      `;

      // Query moderators and super admins who want to receive emails
      const admins = await User.find({
        role: { $in: ['moderator', 'super_admin'] },
        accountStatus: 'active'
      }).select('name email role adminNotificationPreferences');

      for (const admin of admins) {
        const wantsEmail = admin.adminNotificationPreferences?.email !== false;
        if (!wantsEmail || !admin.email) continue;

        try {
          await communicationService.sendEmail({
            email: admin.email,
            subject,
            message: emailBody,
            userObj: { name: admin.name, role: admin.role },
            userId: admin._id
          });
        } catch (emailErr) {
          console.error(`[Hostel Digest] Failed to send digest email to ${admin.email}:`, emailErr.message);
        }
      }
      
      console.log(`[Hostel Digest] Successfully sent hourly digest for ${count} hostels.`);
    } catch (err) {
      console.error('[Hostel Digest Error]', err.message);
    }
  },

  processCommunicationTask
};

module.exports = notificationService;
