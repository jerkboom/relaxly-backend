const mongoose = require('mongoose');
const EmailLog = require('../models/EmailLog');
const DeliveryLog = require('../models/DeliveryLog');
const Campaign = require('../models/Campaign');
const MessageTemplate = require('../models/MessageTemplate');
const CommunicationSettings = require('../models/CommunicationSettings');
const Notification = require('../models/Notification');
const User = require('../models/User');
const emailService = require('./emailService');
const { BACKEND_URL } = require('../config/appConfig');

const getBrandedHtml = (settings, title, body) => {
  const brandColor = settings.brandColor || '#2563EB';
  const logoHtml = settings.logoUrl ? `<img src="${settings.logoUrl}" alt="Logo" style="max-height: 50px; margin-bottom: 20px;" />` : '';
  const footerText = settings.footerText || 'Relaxly Hostel Portal';
  const signature = settings.emailSignature ? settings.emailSignature.replace(/\n/g, '<br />') : 'Best regards,<br />The Relaxly Team';
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
          .header { border-bottom: 1px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 20px; text-align: center; }
          .title { font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 0; }
          .body-content { font-size: 16px; line-height: 1.6; color: #334155; }
          .signature { margin-top: 30px; font-size: 14px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 20px; }
          .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
          .socials { margin-top: 10px; }
          .socials a { color: ${brandColor}; text-decoration: none; margin: 0 10px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              ${logoHtml}
              <h1 class="title">${title}</h1>
            </div>
            <div class="body-content">
              ${body}
            </div>
            <div class="signature">
              ${signature}
            </div>
          </div>
          <div class="footer">
            <p>${footerText}</p>
            <div class="socials">
              ${settings.socialLinks?.twitter ? `<a href="${settings.socialLinks.twitter}">Twitter</a>` : ''}
              ${settings.socialLinks?.facebook ? `<a href="${settings.socialLinks.facebook}">Facebook</a>` : ''}
              ${settings.socialLinks?.instagram ? `<a href="${settings.socialLinks.instagram}">Instagram</a>` : ''}
              ${settings.socialLinks?.linkedin ? `<a href="${settings.socialLinks.linkedin}">LinkedIn</a>` : ''}
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

const compileTemplate = (body, userObj) => {
  if (!userObj) userObj = {};
  return body.replace(/{{name}}/g, userObj.name || 'User')
             .replace(/{{email}}/g, userObj.email || '')
             .replace(/{{role}}/g, userObj.role || '');
};

const communicationService = {
  /**
   * Core sendEmail powered by Resend
   */
  sendEmail: async (options) => {
    const { email, subject, message, templateName, userObj, campaignId, userId } = options;
    
    // 1. Resolve user ID if possible
    let targetUserId = userId;
    if (!targetUserId) {
      const u = await User.findOne({ email }).select('_id');
      if (u) targetUserId = u._id;
    }

    // 2. Load Settings & Templates
    const settings = await CommunicationSettings.getSettings();
    let title = subject || 'Notification';
    let body = message || '';

    if (templateName) {
      const template = await MessageTemplate.findOne({ name: templateName });
      if (template) {
        title = template.title;
        body = compileTemplate(template.body, userObj);
      }
    }

    // 3. Create initial pending log
    const emailLog = await EmailLog.create({
      campaign: campaignId,
      user: targetUserId || new mongoose.Types.ObjectId(),
      email,
      subject: title,
      status: 'pending'
    });

    const trackingPixel = `<img src="${BACKEND_URL}/api/notifications/track/email/${emailLog._id}" width="1" height="1" style="display:none;" />`;
    const finalHtml = getBrandedHtml(settings, title, body) + trackingPixel;

    try {
      const senderDomain = process.env.EMAIL_FROM;
      const resData = await emailService.sendEmail({
        email,
        subject: title,
        html: finalHtml,
        fromName: settings.defaultSenderName || 'Relaxly',
        fromEmail: senderDomain,
        replyTo: settings.replyToEmail,
        campaignId,
        userId: targetUserId
      });

      // Update log to sent
      emailLog.status = 'sent';
      emailLog.messageId = resData?.id;
      emailLog.sentAt = new Date();
      await emailLog.save();

      // Create matching DeliveryLog for Campaign stats
      await DeliveryLog.create({
        campaign: campaignId,
        user: targetUserId || new mongoose.Types.ObjectId(),
        channel: 'EMAIL',
        status: 'SENT',
        sentAt: new Date(),
        referenceId: resData?.id
      });

      if (campaignId) {
        await communicationService._updateCampaignStats(campaignId);
      }

      return resData;
    } catch (error) {
      console.error('[Resend Service Error]:', error.message);
      
      emailLog.status = 'failed';
      emailLog.errorMessage = error.message;
      await emailLog.save();

      await DeliveryLog.create({
        campaign: campaignId,
        user: targetUserId || new mongoose.Types.ObjectId(),
        channel: 'EMAIL',
        status: 'FAILED',
        errorMessage: error.message,
        sentAt: new Date()
      });

      // Create administrative alert notification for failures
      try {
        const socketManager = require('../utils/socketManager');
        const alertMsg = `Failed to deliver email to ${email}: ${error.message}`;
        
        // Find super admins
        const superAdmins = await User.find({ role: 'super_admin' }).select('_id');
        for (const admin of superAdmins) {
          await Notification.create({
            user: admin._id,
            title: 'Email Delivery Failure',
            message: alertMsg,
            type: 'system',
            data: { emailLogId: emailLog._id, email }
          });
          socketManager.notifyUser(admin._id, 'notification_received', { title: 'Email Delivery Failure', message: alertMsg });
        }
      } catch (notifyErr) {
        console.error('Failed to notify admins of email delivery failure:', notifyErr.message);
      }

      if (campaignId) {
        await communicationService._updateCampaignStats(campaignId);
      }

      throw error;
    }
  },

  /**
   * Resend a previously failed email log
   */
  retryEmail: async (logId) => {
    const log = await EmailLog.findById(logId);
    if (!log) throw new Error('Email log not found');

    const options = {
      email: log.email,
      subject: log.subject,
      message: log.errorMessage ? `Retried message: ${log.subject}` : '', // If body is not cached, reuse subject
      campaignId: log.campaign,
      userId: log.user
    };

    return communicationService.sendEmail(options);
  },

  /**
   * Webhook processing from Resend
   */
  processResendWebhook: async (payload) => {
    const { type, data } = payload;
    if (!data || !data.email_id) return { processed: false };

    const emailId = data.email_id;
    let mappedStatus = 'sent';

    switch (type) {
      case 'email.delivered': mappedStatus = 'delivered'; break;
      case 'email.bounced': mappedStatus = 'bounced'; break;
      case 'email.clicked': mappedStatus = 'clicked'; break;
      case 'email.opened': mappedStatus = 'opened'; break;
      default: return { processed: false };
    }

    // Update EmailLog
    const emailLog = await EmailLog.findOneAndUpdate(
      { messageId: emailId },
      { 
        status: mappedStatus,
        ...(mappedStatus === 'delivered' && { deliveredAt: new Date() }),
        ...(mappedStatus === 'opened' && { openedAt: new Date() }),
        ...(mappedStatus === 'clicked' && { clickedAt: new Date() })
      },
      { new: true }
    );

    // Update DeliveryLog
    const deliveryLog = await DeliveryLog.findOneAndUpdate(
      { referenceId: emailId },
      { 
        status: mappedStatus.toUpperCase(),
        ...(mappedStatus === 'delivered' && { deliveredAt: new Date() }),
        ...(mappedStatus === 'opened' && { openedAt: new Date() }),
        ...(mappedStatus === 'clicked' && { clickedAt: new Date() })
      },
      { new: true }
    );

    if (deliveryLog && deliveryLog.campaign) {
      await communicationService._updateCampaignStats(deliveryLog.campaign);
    }

    return { processed: true, emailLog, deliveryLog };
  },

  _updateCampaignStats: async (campaignId) => {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;

    // Fetch related logs and queue items
    const [logs, processingCount] = await Promise.all([
      DeliveryLog.find({ campaign: campaignId }),
      mongoose.model('CommunicationQueue').countDocuments({ campaign: campaignId, status: { $in: ['PENDING', 'PROCESSING'] } })
    ]);

    const stats = {
      sentCount: logs.filter(l => ['SENT', 'DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      deliveredCount: logs.filter(l => ['DELIVERED', 'OPENED', 'CLICKED'].includes(l.status)).length,
      failedCount: logs.filter(l => l.status === 'FAILED').length,
      openCount: logs.filter(l => l.status === 'OPENED').length,
      clickCount: logs.filter(l => l.status === 'CLICKED').length
    };

    const targetCount = campaign.stats.targetCount || 0;
    const processed = stats.sentCount + stats.failedCount;

    // Compute percentages
    const totalDenom = targetCount || processed || 1;
    const deliveryPercentage = Math.round((stats.deliveredCount / totalDenom) * 1000) / 10;
    const failurePercentage = Math.round((stats.failedCount / totalDenom) * 1000) / 10;
    const openPercentage = stats.deliveredCount > 0 ? Math.round((stats.openCount / stats.deliveredCount) * 1000) / 10 : 0;

    let updateData = {
      'stats.sentCount': stats.sentCount,
      'stats.processingCount': processingCount,
      'stats.deliveredCount': stats.deliveredCount,
      'stats.failedCount': stats.failedCount,
      'stats.openCount': stats.openCount,
      'stats.clickCount': stats.clickCount,
      'stats.deliveryPercentage': deliveryPercentage,
      'stats.failurePercentage': failurePercentage,
      'stats.openPercentage': openPercentage
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
  }
};

module.exports = communicationService;
