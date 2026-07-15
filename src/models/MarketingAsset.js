const mongoose = require('mongoose');

const marketingAssetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    category: {
      type: String,
      required: true,
      enum: ['social_media', 'printable', 'videos', 'brand', 'training'],
      default: 'social_media'
    },
    fileUrl: {
      type: String,
      required: true
    },
    publicId: {
      type: String // Cloudinary public_id or unique identifier for deletion/replacement
    },
    fileSize: {
      type: Number,
      default: 0
    },
    fileType: {
      type: String,
      default: 'application/octet-stream'
    },
    thumbnailUrl: {
      type: String
    },
    targetUniversities: {
      type: [String],
      default: [] // Empty means 'All Universities'
    },
    targetBadges: {
      type: [String],
      default: [] // Empty means 'All Badges'
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published'
    },
    expiryDate: {
      type: Date
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    downloadsCount: {
      type: Number,
      default: 0
    },
    uniqueDownloadsCount: {
      type: Number,
      default: 0
    },
    downloads: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        downloadedAt: {
          type: Date,
          default: Date.now
        },
        isFirstDownload: {
          type: Boolean,
          default: false
        }
      }
    ],
    versions: [
      {
        versionNumber: {
          type: Number,
          required: true
        },
        fileUrl: {
          type: String,
          required: true
        },
        publicId: {
          type: String
        },
        fileSize: {
          type: Number,
          default: 0
        },
        fileType: {
          type: String,
          default: 'application/octet-stream'
        },
        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

// Indexes for fast targeting lookup
marketingAssetSchema.index({ status: 1 });
marketingAssetSchema.index({ category: 1 });
marketingAssetSchema.index({ expiryDate: 1 });

module.exports = mongoose.model('MarketingAsset', marketingAssetSchema);
