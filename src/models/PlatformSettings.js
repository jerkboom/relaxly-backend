const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema(
  {
    serviceFee: { type: Number, default: 0, min: 0 },
    serviceFeePercent: { type: Number, default: 0, min: 0, max: 100 },
    estimatedTaxRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },
    manualHostelApproval: { type: Boolean, default: true },
    bookingExpirationMinutes: { type: Number, default: 15, min: 1 },
    autoApprovePayments: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
    supportSettings: {
      email: { type: String, default: 'support@relaxly.io' },
      phone: { type: String, default: '+233000000000' },
      whatsapp: { type: String, default: '+233000000000' }
    },
    roomTypeAdjustments: {
      type: Map,
      of: Number,
      default: {
        '1-in-1': 0,
        '2-in-1': 0,
        '3-in-1': 0,
        '4-in-1': 0,
        '5-in-1': 0,
        '6-in-1': 0,
        '7-in-1': 0,
        '8-in-1': 0
      }
    }
  },
  { timestamps: true }
);

platformSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      serviceFee: 0,
      serviceFeePercent: 0,
      estimatedTaxRate: 0,
      commissionRate: 0,
      commissionPercent: 0,
      manualHostelApproval: true,
      bookingExpirationMinutes: 15,
      autoApprovePayments: false,
      maintenanceMode: false,
      supportSettings: {
        email: 'support@relaxly.io',
        phone: '+233000000000',
        whatsapp: '+233000000000'
      },
      roomTypeAdjustments: {
        '1-in-1': 0,
        '2-in-1': 0,
        '3-in-1': 0,
        '4-in-1': 0,
        '5-in-1': 0,
        '6-in-1': 0,
        '7-in-1': 0,
        '8-in-1': 0
      }
    });
  }
  return settings;
};

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
