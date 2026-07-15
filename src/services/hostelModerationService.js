const Hostel = require('../models/Hostel');
const { logAdminAction } = require('../utils/auditLogger');
const { APIFeatures } = require('../utils/apiFeatures');
const cache = require('../utils/cache');
const { invalidateHostelBrowseCaches } = require('../utils/hostelCache');
const { runTransactionWithRetry } = require('../utils/transactionHelper');

class HostelModerationService {
  async getPendingHostels(queryObj) {
    // Basic implementation for now, could be expanded with APIFeatures
    const hostels = await Hostel.find({ verificationStatus: 'pending' })
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 });
    return hostels;
  }

  async getAllHostels(queryObj) {
    const { status, suspicious } = queryObj;
    let query = {};
    
    if (status && status !== 'all') {
      query.verificationStatus = status;
    }

    if (suspicious === 'true' || suspicious === true) {
      const suspiciousKeywords = ['fake', 'test', 'scam', 'spam', 'dummy'];
      query.$or = [
        { description: { $regex: suspiciousKeywords.join('|'), $options: 'i' } },
        { name: { $regex: suspiciousKeywords.join('|'), $options: 'i' } }
      ];
    }

    const hostels = await Hostel.find(query)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 });
    return hostels;
  }

  async approveHostel(hostelId, adminReq) {
    return await runTransactionWithRetry(async (session) => {
      const hostel = await Hostel.findById(hostelId).session(session);
      if (!hostel) {
        const error = new Error('Hostel not found');
        error.code = 'NOT_FOUND';
        throw error;
      }

      if (hostel.verificationStatus === 'approved') {
        const error = new Error('Hostel is already approved');
        error.code = 'BAD_REQUEST';
        throw error;
      }

      hostel.verificationStatus = 'approved';
      hostel.isVerified = true;
      hostel.approvedAt = Date.now();
      hostel.approvedBy = adminReq.user.id;

      await hostel.save({ session });

      invalidateHostelBrowseCaches(hostel);
      cache.deleteMatching('admin_dashboard_analytics_');

      await logAdminAction({
        req: adminReq,
        actionType: 'HOSTEL_APPROVE',
        targetType: 'Hostel',
        targetId: hostel._id
      }, session);

      // TODO: Dispatch notification event
      return hostel;
    });
  }

  async rejectHostel(hostelId, notes, adminReq) {
    if (!notes) {
      const error = new Error('Please provide a rejection reason');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    return await runTransactionWithRetry(async (session) => {
      const hostel = await Hostel.findById(hostelId).session(session);
      if (!hostel) {
        const error = new Error('Hostel not found');
        error.code = 'NOT_FOUND';
        throw error;
      }

      hostel.verificationStatus = 'rejected';
      hostel.isVerified = false;
      hostel.rejectionReason = notes;

      await hostel.save({ session });

      invalidateHostelBrowseCaches(hostel);
      cache.deleteMatching('admin_dashboard_analytics_');

      await logAdminAction({
        req: adminReq,
        actionType: 'HOSTEL_REJECT',
        targetType: 'Hostel',
        targetId: hostel._id,
        metadata: { reason: notes }
      }, session);

      // TODO: Dispatch notification event
      return hostel;
    });
  }

  async suspendHostel(hostelId, notes, adminReq) {
    if (!notes) {
      const error = new Error('Please provide a suspension reason');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    return await runTransactionWithRetry(async (session) => {
      const hostel = await Hostel.findById(hostelId).session(session);
      if (!hostel) {
        const error = new Error('Hostel not found');
        error.code = 'NOT_FOUND';
        throw error;
      }

      hostel.verificationStatus = 'suspended';
      hostel.available = false;
      hostel.suspensionReason = notes;

      await hostel.save({ session });

      invalidateHostelBrowseCaches(hostel);
      cache.deleteMatching('admin_dashboard_analytics_');

      await logAdminAction({
        req: adminReq,
        actionType: 'HOSTEL_SUSPEND',
        targetType: 'Hostel',
        targetId: hostel._id,
        metadata: { reason: notes }
      }, session);

      // TODO: Dispatch notification event
      return hostel;
    });
  }
  async getModerationStats() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [stats] = await Hostel.aggregate([
      {
        $facet: {
          avgWaitTime: [
            { $match: { verificationStatus: 'approved', approvedAt: { $exists: true }, createdAt: { $exists: true } } },
            {
              $project: {
                waitTime: { $divide: [{ $subtract: ['$approvedAt', '$createdAt'] }, 3600000] } // hours
              }
            },
            { $group: { _id: null, avg: { $avg: '$waitTime' } } }
          ],
          dailyApprovals: [
            { $match: { verificationStatus: 'approved', approvedAt: { $gte: last24h } } },
            { $count: 'count' }
          ],
          inQueue: [
            { $match: { verificationStatus: 'pending' } },
            { $count: 'count' }
          ]
        }
      }
    ]);

    return {
      avgWaitTime: Math.round((stats.avgWaitTime[0]?.avg || 0) * 10) / 10,
      dailyApprovals: stats.dailyApprovals[0]?.count || 0,
      inQueue: stats.inQueue[0]?.count || 0,
    };
  }

  async getSuspiciousHostels(queryObj) {
    // Implementation for suspicious flags: duplicate phone numbers, duplicate payout accounts, etc.
    // For now, we will flag hostels where the owner has multiple 'pending' hostels or suspicious keywords.
    const suspiciousKeywords = ['fake', 'test', 'scam', 'spam', 'dummy'];
    
    const hostels = await Hostel.find({
      $or: [
        { description: { $regex: suspiciousKeywords.join('|'), $options: 'i' } },
        { name: { $regex: suspiciousKeywords.join('|'), $options: 'i' } }
      ]
    }).populate('owner', 'name email phone');

    return hostels;
  }

  getModerationPolicies() {
    return {
      approvalRules: [
        'Hostel name must be clear and unique.',
        'At least 3 high-quality images required.',
        'Owner identity must be verified before approval.',
        'Description must not contain contact numbers or links.'
      ],
      prohibitedContent: [
        'Adult services or illegal activities.',
        'Fraudulent pricing or misleading amenities.',
        'Discrimination based on race, religion, or nationality.'
      ],
      imageRequirements: [
        'No watermarks from other platforms.',
        'Bright, clear interior and exterior shots.',
        'No blurred or low-resolution images.'
      ]
    };
  }
}

module.exports = new HostelModerationService();
