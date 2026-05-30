const cron = require('node-cron');
const CommunicationQueue = require('../models/CommunicationQueue');
const DeliveryLog = require('../models/DeliveryLog');
const EmailLog = require('../models/EmailLog');
const SmsLog = require('../models/SmsLog');
const sendEmail = require('../utils/sendEmail');
const smsService = require('../utils/smsService');
const notificationService = require('../services/notificationService');

const BATCH_SIZE = 50;

const processQueue = async () => {
  const tasks = await CommunicationQueue.find({
    status: { $in: ['PENDING', 'FAILED'] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: 3 }
  })
  .sort({ priority: -1, createdAt: 1 })
  .limit(BATCH_SIZE);

  if (tasks.length === 0) return;

  for (const task of tasks) {
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
        
        // Tracking pixel
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
    } catch (error) {
      task.attempts += 1;
      task.errorLogs.push(error.message);
      task.status = 'FAILED';
      task.nextAttemptAt = new Date(Date.now() + Math.pow(2, task.attempts) * 60000); // exponential backoff
      
      await DeliveryLog.create({ campaign: task.campaign, user: task.user, channel: task.channel, status: 'FAILED', errorMessage: error.message, sentAt: new Date() });
    }
    
    await task.save();
    
    if (task.campaign) {
      await notificationService._updateCampaignStats(task.campaign);
    }
  }
};

const compileTemplate = (body, userObj) => {
  return body.replace(/{{name}}/g, userObj.name || 'User')
             .replace(/{{email}}/g, userObj.email || '')
             .replace(/{{role}}/g, userObj.role || '');
};

const startCommunicationWorker = () => {
  // Run every minute
  cron.schedule('* * * * *', () => {
    console.log('[Worker] Running Communication Queue...');
    processQueue().catch(err => console.error('[Worker] Queue error:', err));
  });
  console.log('Communication Worker started');
};

module.exports = { startCommunicationWorker, processQueue };
