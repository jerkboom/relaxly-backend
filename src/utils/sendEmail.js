const communicationService = require('../services/communicationService');

/**
 * Unified platform email sender wrapper.
 * Delegates outgoing emails to the CommunicationService to log states,
 * apply admin branding presets, and trace errors.
 * 
 * @param {Object} options - Email parameters
 * @param {string} options.email - Destination recipient
 * @param {string} options.subject - Subject line
 * @param {string} options.message - Message body
 * @returns {Promise<Object>} Resend response envelope
 */
const sendEmail = async (options) => {
  return communicationService.sendEmail(options);
};

module.exports = sendEmail;
