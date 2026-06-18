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
      address: {
        type: String,
        required: true,
      },
      city: {
        type: String,
        default: '',
      },
      region: {
        type: String,
        default: '',
      },
      latitude: {
        type: Number,
      },
      longitude: {
        type: Number,
      },
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
    nearestUniversity: {
      type: String,
      trim: true,
      default: '',
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
    timesSaved: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// GLOBAL DATA TRANSFORMATION: Prevent React from crashing when rendering location object
const transformLocation = (doc, ret) => {
  if (ret.location && typeof ret.location === 'object') {
    // Preserve full details
    ret.locationDetails = JSON.parse(JSON.stringify(ret.location));
    
    // Expose root level coordinates for Maps
    ret.latitude = ret.location.latitude;
    ret.longitude = ret.location.longitude;
    
    // Flatten primary location field to String to prevent React child error
    ret.location = ret.location.address || '';
  }
  return ret;
};

hostelSchema.set('toJSON', { transform: transformLocation, virtuals: true });
hostelSchema.set('toObject', { transform: transformLocation, virtuals: true });

// INDEXES FOR SEARCH & MODERATION
hostelSchema.index({ verificationStatus: 1, available: 1 });
hostelSchema.index({ owner: 1, verificationStatus: 1 });
hostelSchema.index({ university: 1 });
hostelSchema.index({ 'location.city': 1 });
hostelSchema.index({ nearestUniversity: 1 });
hostelSchema.index({ nearbyUniversities: 1 });
hostelSchema.index({ 'nearestInstitution.name': 1 });
hostelSchema.index({ amenities: 1 });
hostelSchema.index({ createdAt: -1 });
hostelSchema.index({ verificationStatus: 1, available: 1, nearestUniversity: 1, createdAt: -1 });
hostelSchema.index({ verificationStatus: 1, available: 1, 'location.city': 1, createdAt: -1 });
hostelSchema.index({ verificationStatus: 1, available: 1, amenities: 1, createdAt: -1 });

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
