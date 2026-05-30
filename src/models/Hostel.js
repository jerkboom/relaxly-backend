const mongoose = require('mongoose');

const hostelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    location: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    pricingType: {
      type: String,
      enum: ['monthly', 'semester', 'academic year'],
      default: 'semester',
    },

    images: [
      {
        type: String,
      },
    ],

    featuredImage: {
      type: String,
    },

    rules: [{ type: String }],
    policies: [{ type: String }],
    amenities: [
      {
        type: String,
      },
    ],

    // Specific amenities for quick filtering
    wifi: { type: Boolean, default: false },
    ac: { type: Boolean, default: false },
    security: { type: Boolean, default: false },
    water: { type: Boolean, default: false },
    electricity: { type: Boolean, default: false },

    totalRooms: {
      type: Number,
      default: 0,
    },

    availableRooms: {
      type: Number,
      default: 0,
    },

    genderAllowed: {
      type: String,
      enum: ['Mixed', 'Male', 'Female'],
      default: 'Mixed',
    },

    university: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'University',
      required: false,
    },

    nearbyUniversities: {
      type: [String],
      default: [],
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    available: {
      type: Boolean,
      default: true,
    },

    // MODERATION FIELDS
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'SUSPENDED'],
      default: 'pending',
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    approvedAt: {
      type: Date,
    },

    rejectionReason: {
      type: String,
    },

    suspensionReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// INDEXES FOR SEARCH & MODERATION
hostelSchema.index({ verificationStatus: 1, available: 1 });
hostelSchema.index({ owner: 1, verificationStatus: 1 });

// REFERENTIAL INTEGRITY VALIDATION
hostelSchema.pre('save', async function() {
  if (this.isModified('owner') || this.isNew) {
    const ownerExists = await mongoose.model('User').exists({ _id: this.owner });
    if (!ownerExists) {
      throw new Error(`Referential Integrity Error: Owner with ID ${this.owner} does not exist.`);
    }
  }
});

module.exports = mongoose.model('Hostel', hostelSchema);
