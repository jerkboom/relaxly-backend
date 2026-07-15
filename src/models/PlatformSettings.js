const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema(
  {
    serviceFee: { type: Number, default: 0, min: 0 },
    serviceFeePercent: { type: Number, default: 0, min: 0, max: 100 },
    estimatedTaxRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },
    ambassadorCommissionType: { type: String, enum: ['flat', 'percentage'], default: 'flat' },
    ambassadorCommissionValue: { type: Number, default: 30, min: 0 },
    ambassadorMinPayoutAmount: { type: Number, default: 100, min: 0 },
    manualHostelApproval: { type: Boolean, default: true },
    bookingExpirationMinutes: { type: Number, default: 15, min: 1 },
    autoApprovePayments: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
    supportSettings: {
      whatsapp: {
        number: { type: String, default: '+233541234567' },
        displayName: { type: String, default: 'Relaxly Support' },
        defaultMessage: { type: String, default: 'Hello Relaxly Support, I need assistance with my booking.' },
        enabled: { type: Boolean, default: true }
      },
      email: {
        address: { type: String, default: 'support@relaxly.io' },
        displayName: { type: String, default: 'Relaxly Support' },
        responseTime: { type: String, default: 'Within 2 hours' },
        enabled: { type: Boolean, default: true }
      },
      workingHours: {
        timezone: { type: String, default: 'Africa/Accra' },
        weekdays: {
          open: { type: String, default: '08:00' },
          close: { type: String, default: '18:00' }
        },
        weekend: {
          open: { type: String, default: '09:00' },
          close: { type: String, default: '14:00' }
        }
      }
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
      ambassadorCommissionType: 'flat',
      ambassadorCommissionValue: 30,
      ambassadorMinPayoutAmount: 100,
      manualHostelApproval: true,
      bookingExpirationMinutes: 15,
      autoApprovePayments: false,
      maintenanceMode: false,
      supportSettings: {
        whatsapp: {
          number: '+233541234567',
          displayName: 'Relaxly Support',
          defaultMessage: 'Hello Relaxly Support, I need assistance with my booking.',
          enabled: true
        },
        email: {
          address: 'support@relaxly.io',
          displayName: 'Relaxly Support',
          responseTime: 'Within 2 hours',
          enabled: true
        },
        workingHours: {
          timezone: 'Africa/Accra',
          weekdays: {
            open: '08:00',
            close: '18:00'
          },
          weekend: {
            open: '09:00',
            close: '14:00'
          }
        }
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
