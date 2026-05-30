const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    content: {
      type: String,
      required: true
    },
    channel: {
      type: String,
      enum: ['app', 'email', 'sms'],
      default: 'app'
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent'
    },
    readAt: {
      type: Date
    }
  },
  { timestamps: true }
);

messageSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
