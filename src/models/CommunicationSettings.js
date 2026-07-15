const mongoose = require('mongoose');

const communicationSettingsSchema = new mongoose.Schema({
  defaultSenderName: { type: String, default: 'Relaxly Team' },
  supportEmail: { type: String, default: 'support@relaxly.io' },
  replyToEmail: { type: String, default: 'support@relaxly.io' },
  emailSignature: { type: String, default: 'Best regards,\nThe Relaxly Team' },
  logoUrl: { type: String, default: '' },
  brandColor: { type: String, default: '#2563EB' }, // Blue-600
  footerText: { type: String, default: 'Relaxly Hostel Portal - Helping students find verified accommodations.' },
  socialLinks: {
    twitter: { type: String, default: '' },
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    linkedin: { type: String, default: '' }
  }
}, { timestamps: true });

communicationSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('CommunicationSettings', communicationSettingsSchema);
