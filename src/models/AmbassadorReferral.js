const mongoose = require('mongoose');

const ambassadorReferralSchema = new mongoose.Schema(
  {
    ambassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredStudent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // A student can only be referred once
      index: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AmbassadorReferral', ambassadorReferralSchema);
