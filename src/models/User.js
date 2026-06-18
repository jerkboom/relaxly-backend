const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
      },
      email: {
        type: String,
        required: true,
        unique: true,
      },
      password: {
        type: String,
        required: true,
      },
      phone: {
        type: String,
        trim: true,
      },
      whatsapp: {
        type: String,
        trim: true,
      },
      isEmailVerified: {
        type: Boolean,
        default: false,
      },
      isStudentVerified: {
        type: Boolean,
        default: false,
      },
      isOwnerVerified: {
        type: Boolean,
        default: false,
      },
      verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'approved', 'rejected'],
        default: 'pending',
      },
      // ACCOUNT STATUS
      accountStatus: {
        type: String,
        enum: ['active', 'suspended', 'banned', 'deactivated', 'pending'],
        default: 'active',
      },
      schoolName: {
        type: String,
        trim: true,
      },
      studentId: {
        type: String,
        trim: true,
      },
      ownerAccessCode: {
        type: String,
        trim: true,
      },
      governmentIdUrl: {
        type: String,
      },
      approvedAt: {
        type: Date,
      },
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      rejectionReason: {
        type: String,
      },
      suspensionReason: {
        type: String,
      },
      payoutFrozen: {
        type: Boolean,
        default: false,
      },
      payoutFreezeReason: {
        type: String,
      },
      emailVerificationToken: {
        type: String,
      },
      emailVerificationExpires: {
        type: Date,
      },
      resetPasswordToken: {
        type: String,
      },
      resetPasswordExpire: {
        type: Date,
      },
      role: {
        type: String,
        enum: [
          'student',
          'owner',
          'super_admin',
          'finance_admin',
          'moderator',
          'support_admin',
          'admin'
        ],
        default: 'student',
      },
      commissionRate: {
        type: Number,
        default: null,
        min: [0, 'Commission rate cannot be less than 0%'],
        max: [100, 'Commission rate cannot exceed 100%'],
      },
      paystackSubaccountCode: {
        type: String,
        trim: true,
      },
      bankName: {
        type: String,
        trim: true,
      },
      accountNumber: {
        type: String,
        trim: true,
      },
      accountName: {
        type: String,
        trim: true,
      },
      university: { type: mongoose.Schema.Types.ObjectId, ref: 'University' },
      customUniversity: { type: String, default: null },
      avatar: {
        type: String,
      },
      profileImage: {
        type: String,
      },
      bio: {
        type: String,
        trim: true,
        maxlength: 500,
      },

      payoutEnabled: {
        type: Boolean,
        default: false,
      },

      payoutMethod: {
        type: {
          type: String,
          enum: ['momo', 'bank'],
        },
        recipientCode: {
          type: String,
        },
        accountName: {
          type: String,
        },
        verified: {
          type: Boolean,
          default: false,
        },
        momo: {
          network: {
            type: String,
            enum: ['MTN', 'TELECEL', 'AIRTELTIGO'],
          },
          phoneNumber: String,
        },
        bank: {
          bankName: String,
          accountNumber: String,
        },
      },
      gender: {
        type: String,
        enum: ['Male', 'Female'],
      },
      wishlist: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Hostel',
        },
      ],
    },
    {
      timestamps: true,
    }
);

userSchema.index({ role: 1, accountStatus: 1 });
userSchema.index({ gender: 1 });

userSchema.pre('save', async function () {
    // 1. Password Hashing
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // 2. Automatic Verification Logic
    // Only trigger if isEmailVerified is true AND verificationStatus is still pending
    if (this.isEmailVerified && this.verificationStatus === 'pending') {
      if (this.role === 'student') {
        this.verificationStatus = 'verified';
        this.isStudentVerified = true;
      } else if (this.role === 'owner') {
        // For owners, email verification marks the first step
        this.isOwnerVerified = true;
        this.verificationStatus = 'verified';
      }
    }
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.generateEmailVerificationToken = function () {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    this.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    return verificationToken;
};

module.exports = mongoose.model('User', userSchema);
