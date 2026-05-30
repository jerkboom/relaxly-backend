const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true },
  subject: { type: String },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed', 'opened', 'clicked'], default: 'pending' },
  errorMessage: { type: String },
  sentAt: { type: Date },
  openedAt: { type: Date },
  clickedAt: { type: Date },
  messageId: { type: String },
}, { timestamps: true });

emailLogSchema.index({ campaign: 1, status: 1 });
emailLogSchema.index({ user: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
