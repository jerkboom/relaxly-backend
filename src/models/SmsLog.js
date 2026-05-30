const mongoose = require('mongoose');

const smsLogSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone: { type: String, required: true },
  message: { type: String },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed'], default: 'pending' },
  errorMessage: { type: String },
  sentAt: { type: Date },
  messageId: { type: String },
  provider: { type: String, default: 'twilio' }
}, { timestamps: true });

smsLogSchema.index({ campaign: 1, status: 1 });
smsLogSchema.index({ user: 1 });

module.exports = mongoose.model('SmsLog', smsLogSchema);
