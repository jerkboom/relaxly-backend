/**
 * ==================================================
 * Relaxly Backend
 * File: Admin.js
 *
 * Purpose:
 * Defines the Admin model for managing platform
 * administrators, their roles, permissions, and
 * authentication lifecycle.
 *
 * Author: Relaxly Team
 * ==================================================
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Admin Model
 *
 * Stores information about administrative users
 * who manage the Relaxly platform.
 */
const adminSchema = new mongoose.Schema({
  // Full name of the administrator
  name: {
    type: String,
    required: [true, 'Please add a name']
  },
  // Unique email used for login and notifications
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  // Hashed password for authentication (hidden by default)
  password: {
    type: String,
    minlength: 6,
    select: false
  },
  // Defines the level of access within the admin dashboard
  role: {
    type: String,
    enum: ['super_admin', 'finance_admin', 'moderator', 'support_admin', 'marketing_admin'],
    default: 'support_admin'
  },
  // Specific permission strings for granular access control
  permissions: {
    type: [String],
    default: []
  },
  // Reference to the user/admin who invited this account
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  invitedAt: {
    type: Date,
    default: Date.now
  },
  // Token for account activation
  activationToken: String,
  activationExpires: Date,
  lastLogin: {
    type: Date
  },
  // Forces a password change upon first login
  mustResetPassword: {
    type: Boolean,
    default: true
  },
  // Whether the account is fully set up and ready
  isActive: {
    type: Boolean,
    default: false
  },
  // Lifecycle status of the admin account
  status: {
    type: String,
    enum: ['active', 'suspended', 'pending'],
    default: 'pending'
  },
  // Optional field for digital audit trail signing
  auditSignature: {
    type: String
  },
  // Multi-Factor Authentication status
  mfaEnabled: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

/**
 * Encrypt password using bcrypt before saving.
 * Checks if modified and avoids double-hashing.
 */
adminSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }

  if (this.password && this.password.startsWith('$2')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Match admin entered password to hashed password in database.
 */
adminSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * Generate and hash activation token for new admin invitations.
 */
adminSchema.methods.generateActivationToken = function() {
  const activationToken = crypto.randomBytes(32).toString('hex');

  this.activationToken = crypto
    .createHash('sha256')
    .update(activationToken)
    .digest('hex');

  this.activationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return activationToken;
};

module.exports = mongoose.model('Admin', adminSchema);
