const { Resend } = require('resend');
const mongoose = require('mongoose');
const EmailLog = require('../models/EmailLog');
const DeliveryLog = require('../models/DeliveryLog');

let resendClient = null;
let isEmailEnabled = false;

/**
 * Initialize and Validate Resend API Key during startup
 */
const initEmailService = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 're_test_key_placeholder' || apiKey === 're_xxxxxxxxxxxxxxxxxxxxxxxxx') {
    console.warn('\n================================================================');
    console.warn('⚠️  WARNING: RESEND_API_KEY is missing or contains placeholder!');
    console.warn('Email sending functionality will be DISABLED.');
    console.warn('Please configure a valid Resend API key in backend/.env');
    console.warn('================================================================\n');
    isEmailEnabled = false;
    resendClient = null;
  } else {
    try {
      resendClient = new Resend(apiKey);
      isEmailEnabled = true;
      const maskedKey = apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 4);
      console.log(`✅ Resend Email Service initialized successfully with key: ${maskedKey}`);
    } catch (err) {
      console.error('❌ Failed to initialize Resend client:', err.message);
      isEmailEnabled = false;
      resendClient = null;
    }
  }
};

// Run initialization immediately on require
initEmailService();

/**
 * Send an email using the verified Resend client
 */
const sendEmail = async (options) => {
  const { email, subject, html, campaignId, userId } = options;

  if (!isEmailEnabled || !resendClient) {
    const errorMsg = 'Email sending is disabled because RESEND_API_KEY is missing or invalid.';
    console.warn(`[EmailService] Cannot send email to ${email}: ${errorMsg}`);
    
    // Log attempt as failed in DB
    await EmailLog.create({
      campaign: campaignId,
      user: userId || new mongoose.Types.ObjectId(),
      email,
      subject: subject || 'No Subject',
      status: 'failed',
      errorMessage: errorMsg,
      sentAt: new Date()
    });

    await DeliveryLog.create({
      campaign: campaignId,
      user: userId || new mongoose.Types.ObjectId(),
      channel: 'EMAIL',
      status: 'FAILED',
      errorMessage: errorMsg,
      sentAt: new Date()
    });

    throw new Error(errorMsg);
  }

  const fromName = options.fromName || 'Relaxly';
  const fromEmail = options.fromEmail || process.env.EMAIL_FROM || 'noreply@relaxlygh.com';
  const from = `${fromName} <${fromEmail}>`;

  const payload = {
    from,
    to: email,
    subject,
    html
  };

  if (options.replyTo) {
    payload.reply_to = options.replyTo;
  }

  const result = await resendClient.emails.send(payload);
  if (result.error) {
    throw new Error(result.error.message || 'Resend Gateway returned error');
  }

  return result.data; // contains id
};

module.exports = {
  sendEmail,
  isEmailEnabled: () => isEmailEnabled,
  reinit: initEmailService
};
