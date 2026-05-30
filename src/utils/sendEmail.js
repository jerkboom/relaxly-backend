const { Resend } = require('resend');

// Singleton Resend client
let resendClient = null;

const getResendClient = () => {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      console.warn('⚠️ RESEND_API_KEY is missing from environment variables');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

/**
 * Send email using Resend
 * @param {Object} options - Email options
 * @param {string} options.email - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.message - HTML message content
 * @returns {Promise<Object>} Resend response
 */
const sendEmail = async (options) => {
  console.log('--- EMAIL SEND START ---');
  console.log('To:', options.email);
  console.log('Subject:', options.subject);

  try {
    const resend = getResendClient();

    const { data, error } = await resend.emails.send({
      from: 'Relaxly <onboarding@resend.dev>',
      to: options.email,
      subject: options.subject,
      html: options.message,
    });

    if (error) {
      throw error;
    }

    console.log('--- EMAIL SEND SUCCESS ---');
    console.log('Resend ID:', data.id);
    return data;
  } catch (error) {
    console.error('--- EMAIL SEND ERROR ---');
    console.error('Error Message:', error.message || error);
    throw error;
  }
};

module.exports = sendEmail;
