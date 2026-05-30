const User = require('../models/User');
const Hostel = require('../models/Hostel');
const Booking = require('../models/Booking');
const PayoutQueue = require('../models/PayoutQueue');
const { logAdminAction } = require('../utils/auditLogger');

class OwnerGovernanceService {
  /**
   * Update custom commission rate for an owner
   */
  async updateCommission(ownerId, customCommissionRate, adminReq) {
    const owner = await User.findById(ownerId);
    if (!owner) throw new Error('Owner not found');
    if (owner.role !== 'owner') throw new Error('User is not an owner');

    if (customCommissionRate < 0 || customCommissionRate > 100) {
      throw new Error('Commission rate must be between 0 and 100');
    }

    const oldRate = owner.commissionRate;
    owner.commissionRate = customCommissionRate;
    await owner.save();

    await logAdminAction({
      req: adminReq,
      actionType: 'COMMISSION_OVERRIDE',
      targetType: 'User',
      targetId: owner._id,
      metadata: { oldRate, newRate: customCommissionRate }
    });

    return owner;
  }

  /**
   * Toggle payout freeze for an owner
   */
  async togglePayoutFreeze(ownerId, frozen, reason, adminReq) {
    const owner = await User.findById(ownerId);
    if (!owner) throw new Error('Owner not found');
    if (owner.role !== 'owner') throw new Error('User is not an owner');

    const oldState = owner.payoutFrozen;
    owner.payoutFrozen = frozen;
    owner.payoutFreezeReason = frozen ? reason : null;
    await owner.save();

    await logAdminAction({
      req: adminReq,
      actionType: frozen ? 'PAYOUT_FREEZE' : 'PAYOUT_UNFREEZE',
      targetType: 'User',
      targetId: owner._id,
      metadata: { oldState, newState: frozen, reason }
    });

    return owner;
  }

  /**
   * Suspend an owner account
   */
  async suspendOwner(ownerId, reason, adminReq) {
    const owner = await User.findById(ownerId);
    if (!owner) throw new Error('Owner not found');

    // SAFETY GUARDS
    if (owner.role === 'super_admin') {
      throw new Error('Cannot suspend a Super Admin account via owner governance');
    }

    if (adminReq.user.id === owner._id.toString()) {
      throw new Error('Cannot suspend your own account');
    }

    const oldStatus = owner.accountStatus;
    owner.accountStatus = 'suspended';
    owner.suspensionReason = reason;
    await owner.save();

    // Optionally hide hostels
    await Hostel.updateMany(
      { owner: ownerId },
      { available: false }
    );

    await logAdminAction({
      req: adminReq,
      actionType: 'USER_SUSPEND',
      targetType: 'User',
      targetId: owner._id,
      metadata: { oldStatus, newStatus: 'suspended', reason }
    });

    return owner;
  }

  /**
   * Unsuspend an owner account
   */
  async unsuspendOwner(ownerId, adminReq) {
    const owner = await User.findById(ownerId);
    if (!owner) throw new Error('Owner not found');

    const oldStatus = owner.accountStatus;
    owner.accountStatus = 'active';
    owner.suspensionReason = null;
    await owner.save();

    // Optionally restore hostels (only those that were previously approved)
    await Hostel.updateMany(
      { owner: ownerId, verificationStatus: 'approved' },
      { available: true }
    );

    await logAdminAction({
      req: adminReq,
      actionType: 'USER_UNSUSPEND',
      targetType: 'User',
      targetId: owner._id,
      metadata: { oldStatus, newStatus: 'active' }
    });

    return owner;
  }

  /**
   * Safely delete an owner account (Soft Delete)
   */
  async deleteOwner(ownerId, adminReq) {
    const owner = await User.findById(ownerId);
    if (!owner) throw new Error('Owner not found');

    // BLOCK deletion if active bookings exist
    const activeBookings = await Booking.countDocuments({
      hostel: { $in: await Hostel.find({ owner: ownerId }).distinct('_id') },
      bookingStatus: { $in: ['pending', 'approved'] }
    });

    if (activeBookings > 0) {
      throw new Error(`Cannot delete owner. ${activeBookings} active bookings still exist.`);
    }

    // BLOCK if pending payouts exist
    const pendingPayouts = await PayoutQueue.countDocuments({
      owner: ownerId,
      status: { $in: ['pending', 'approved', 'processing', 'otp_pending'] }
    });

    if (pendingPayouts > 0) {
      throw new Error(`Cannot delete owner. ${pendingPayouts} pending payouts still exist.`);
    }

    const oldStatus = owner.accountStatus;
    
    // Soft Delete: Anonymize and mark as deactivated
    owner.accountStatus = 'deactivated';
    owner.name = `Deleted Owner ${owner._id.toString().slice(-4)}`;
    owner.email = `deleted_${owner._id}@relaxly.io`;
    owner.phone = '0000000000';
    owner.password = 'DELETED';
    owner.isEmailVerified = false;
    owner.isOwnerVerified = false;
    owner.payoutEnabled = false;
    
    await owner.save();

    // Hide all hostels
    await Hostel.updateMany(
      { owner: ownerId },
      { available: false, verificationStatus: 'suspended' }
    );

    await logAdminAction({
      req: adminReq,
      actionType: 'USER_DELETE',
      targetType: 'User',
      targetId: owner._id,
      metadata: { oldStatus, newStatus: 'deactivated' }
    });

    return { success: true, message: 'Owner account safely soft-deleted and anonymized.' };
  }
}

module.exports = new OwnerGovernanceService();
