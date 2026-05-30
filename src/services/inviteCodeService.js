const OwnerInviteCode = require('../models/OwnerInviteCode');
const crypto = require('crypto');

class InviteCodeService {
  /**
   * Generate a new unique invite code
   */
  async generateCode(adminId, email, duration = '7d') {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const code = `HH-ROYALS-${randomDigits}`;

    let expiresAt = new Date();
    if (duration === 'never') {
      expiresAt = null;
    } else if (typeof duration === 'string' && duration.endsWith('h')) {
      const hours = parseInt(duration.replace('h', ''));
      expiresAt.setHours(expiresAt.getHours() + hours);
    } else if (typeof duration === 'string' && duration.endsWith('d')) {
      const days = parseInt(duration.replace('d', ''));
      expiresAt.setDate(expiresAt.getDate() + days);
    } else {
      const days = parseInt(duration);
      expiresAt.setDate(expiresAt.getDate() + (isNaN(days) ? 7 : days));
    }

    const inviteCode = await OwnerInviteCode.create({
      code,
      assignedToEmail: email,
      createdBy: adminId,
      expiresAt,
      neverExpires: duration === 'never'
    });

    return inviteCode;
  }

  /**
   * Get all invite codes with populated references
   */
  async getAllCodes() {
    return await OwnerInviteCode.find()
      .populate('createdBy', 'name email')
      .populate('usedBy', 'name email')
      .sort({ createdAt: -1 });
  }

  /**
   * Revoke/Delete an invite code
   */
  async revokeCode(id) {
    const invite = await OwnerInviteCode.findById(id);
    if (!invite) {
      const error = new Error('Invite code not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    await invite.deleteOne();
    return true;
  }

  /**
   * Validate a code and associate it with a user
   */
  async validateAndUseCode(code, user) {
    const invite = await OwnerInviteCode.findOne({ code, isUsed: false });
    
    if (!invite) {
      const error = new Error('Invalid or already used invite code');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (!invite.neverExpires && invite.expiresAt && new Date() > invite.expiresAt) {
      const error = new Error('Invite code has expired');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Mark code as used
    invite.isUsed = true;
    invite.usedBy = user._id;
    await invite.save();

    // Update user status
    user.ownerAccessCode = code;
    user.isOwnerVerified = true;
    user.verificationStatus = 'approved'; // Automatically approve upon valid code entry
    user.accountStatus = 'active';
    user.approvedAt = Date.now();
    
    await user.save();
    console.log("OWNER AUTO-APPROVED VIA ACCESS CODE");

    return invite;
  }
}

module.exports = new InviteCodeService();
