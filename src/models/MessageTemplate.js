const mongoose = require('mongoose');

const messageTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  subtitle: { type: String },
  body: { type: String, required: true },
  ctaText: { type: String },
  ctaLink: { type: String },
  bannerImage: { type: String },
  type: { type: String, enum: ['system', 'marketing', 'emergency', 'transactional'], default: 'system' },
  channels: [{ type: String, enum: ['dashboard', 'email', 'sms'] }],
  variables: [String], // Keys that can be replaced like {{name}}
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
