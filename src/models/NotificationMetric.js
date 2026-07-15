const mongoose = require('mongoose');

const notificationMetricSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('NotificationMetric', notificationMetricSchema);
