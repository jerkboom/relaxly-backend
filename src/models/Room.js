const mongoose = require('mongoose');
const PlatformSettings = require('./PlatformSettings');

const roomSchema = new mongoose.Schema(
  {
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: true,
    },

    roomType: {
      type: String,
      required: true,
    },

    occupancyStyle: {
      type: String,
      enum: ['1-in-1', '2-in-1', '3-in-1', '4-in-1', '5-in-1', '6-in-1', '7-in-1', '8-in-1'],
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    basePrice: {
      type: Number,
    },

    adjustmentAmount: {
      type: Number,
      default: 0,
    },

    totalPrice: {
      type: Number,
    },

    billingPeriod: {
      type: String,
      enum: ['monthly', 'semester', 'academic year'],
      default: 'semester',
    },

    capacity: {
      type: Number,
      required: true,
    },

    availableBeds: {
      type: Number,
      required: true,
      default: 0,
    },

    maleAvailableBeds: {
      type: Number,
      default: 0,
    },

    femaleAvailableBeds: {
      type: Number,
      default: 0,
    },

    privateWashroom: {
      type: Boolean,
      default: false,
    },

    hasAC: {
      type: Boolean,
      default: false,
    },

    images: [
      {
        type: String,
      },
    ],

    featuredImage: {
      type: String,
    },

    genderAllocation: {
      type: String,
      enum: ['Mixed', 'Male', 'Female'],
      default: 'Mixed',
    },

    amenities: [
      {
        type: String,
      },
    ],

    description: {
      type: String,
    },

    roomStatus: {
      type: String,
      enum: ['available', 'unavailable', 'maintenance'],
      default: 'available',
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

roomSchema.index({ hostel: 1 });
roomSchema.index({ hostel: 1, availableBeds: 1, roomStatus: 1 });
roomSchema.index({ hostel: 1, genderAllocation: 1, roomStatus: 1, availableBeds: 1 });

// SYNC PRICING AND AVAILABILITY
roomSchema.pre('save', async function () {
  // 1. CALCULATE PRICING ADJUSTMENTS
  // Treat the incoming 'price' field as the base price for owners
  if (this.isModified('price') || this.isNew) {
    this.basePrice = this.price;
  }

  // Ensure basePrice is never undefined
  if (this.basePrice === undefined) {
    this.basePrice = this.price;
  }

  // Fetch global adjustments based on occupancy style
  const settings = await PlatformSettings.getSettings();
  const adjustment = settings.roomTypeAdjustments?.get(this.occupancyStyle) ||
                     settings.roomTypeAdjustments?.[this.occupancyStyle] || 0;

  this.adjustmentAmount = adjustment;
  this.totalPrice = this.basePrice + this.adjustmentAmount;

  // IMPORTANT: Update the main price field to reflect the final student cost
  this.price = this.totalPrice;

  // 2. AVAILABILITY SYNC
  // Male-only rooms
  if (this.genderAllocation === 'Male') {
    this.femaleAvailableBeds = 0;
  }

  // Female-only rooms
  if (this.genderAllocation === 'Female') {
    this.maleAvailableBeds = 0;
  }

  // Safely convert values to numbers
  const maleBeds = Number(this.maleAvailableBeds || 0);
  const femaleBeds = Number(this.femaleAvailableBeds || 0);
  const totalBeds = maleBeds + femaleBeds;

  // Sync total available beds
  this.availableBeds = totalBeds;

  // Prevent capacity overflow
  if (totalBeds > this.capacity) {
    throw new Error(
      `Available beds (${totalBeds}) cannot exceed capacity (${this.capacity})`
    );
  }

  // Prevent negative values
  if (maleBeds < 0 || femaleBeds < 0) {
    throw new Error(
      'Available bed counts cannot be negative'
    );
  }

  // Auto-manage room status
  if (totalBeds === 0) {
    this.roomStatus = 'unavailable';
  } else if (this.roomStatus === 'unavailable') {
    this.roomStatus = 'available';
  }

  // REFERENTIAL INTEGRITY VALIDATION
  if (this.isModified('hostel') || this.isNew) {
    const hostelExists = await mongoose.model('Hostel').exists({ _id: this.hostel });
    if (!hostelExists) {
      throw new Error(`Referential Integrity Error: Hostel with ID ${this.hostel} does not exist.`);
    }
  }
});

module.exports = mongoose.model('Room', roomSchema);
