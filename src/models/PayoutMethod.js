const mongoose = require('mongoose');

const payoutMethodSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['momo', 'bank'],
    required: true
  },
  accountName: {
    type: String,
    required: true
  },
  accountNumber: {
    type: String,
    required: true
  },
  bankCode: {
    type: String, // Also used for provider/network for MoMo
  },
  provider: {
    type: String, // MTN, TELECEL, AIRTELTIGO
  },
  recipientCode: {
    type: String,
    required: true
  },
  recipientId: {
    type: String,
  },
  currency: {
    type: String,
    default: 'GHS'
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PayoutMethod', payoutMethodSchema);
