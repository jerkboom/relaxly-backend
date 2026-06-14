const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const TransactionLedger = require('../models/TransactionLedger');
const PayoutQueue = require('../models/PayoutQueue');
const AdminAuditLog = require('../models/AdminAuditLog');
const Notification = require('../models/Notification');
const Hostel = require('../models/Hostel');
const OwnerActivityLog = require('../models/OwnerActivityLog');

class OwnerTimelineService {
  /**
   * Aggregates activity for a specific owner across all platform domains.
   * @param {string} ownerId 
   * @param {number} page 
   * @param {number} limit 
   */
  async getOwnerTimeline(ownerId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const oid = new mongoose.Types.ObjectId(ownerId);

    // 1. Identify all Hostels owned by this user to find related events
    const ownerHostels = await Hostel.find({ owner: oid }).select('_id name');
    const hostelIds = ownerHostels.map(h => h._id);

    /**
     * SOURCE 1: OWNER ACTIVITY LOG (Forensic Audit Trail)
     * Direct actions performed by the owner.
     */
    const forensicLogs = await OwnerActivityLog.find({ ownerId: oid })
      .sort({ createdAt: -1 })
      .lean();

    const forensicEvents = forensicLogs.map(log => ({
      eventType: log.eventType,
      title: log.title,
      description: log.description,
      timestamp: log.createdAt,
      ownerId: oid,
      actorName: log.actorName,
      actorRole: log.actorRole,
      metadata: log.metadata
    }));

    /**
     * SOURCE 2: BOOKING HISTORY
     * We look at all bookings for the owner's hostels.
     */
    const bookings = await Booking.find({ hostel: { $in: hostelIds } })
      .populate('student', 'name email')
      .populate('hostel', 'name')
      .lean();

    const bookingEvents = [];
    bookings.forEach(b => {
      if (b.history && Array.isArray(b.history)) {
        b.history.forEach(h => {
          bookingEvents.push({
            eventType: 'booking',
            title: h.event.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
            description: h.details,
            timestamp: h.timestamp || b.updatedAt,
            ownerId: oid,
            hostelId: b.hostel?._id,
            bookingId: b._id,
            studentId: b.student?._id,
            metadata: {
              hostelName: b.hostel?.name,
              studentName: b.student?.name,
              bookingCode: b.bookingCode
            }
          });
        });
      }
    });

    /**
     * SOURCE 3: PAYOUT QUEUE
     * Payout status transitions for this owner.
     */
    const payouts = await PayoutQueue.find({ owner: oid })
      .populate('hostel', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const payoutEvents = payouts.map(p => ({
      eventType: 'finance',
      title: `Payout ${p.status.toUpperCase()}`,
      description: `Payout of GH₵${p.amount} for ${p.hostel?.name || 'Hostel'} is now ${p.status}.`,
      timestamp: p.updatedAt,
      ownerId: oid,
      hostelId: p.hostel?._id,
      bookingId: p.booking,
      amount: p.amount,
      metadata: {
        status: p.status,
        transferCode: p.transferCode,
        failureReason: p.failureReason
      }
    }));

    /**
     * SOURCE 4: TRANSACTION LEDGER (Financial)
     * Payments and Refunds related to owner's bookings.
     */
    const transactions = await TransactionLedger.find({ 
      booking: { $in: bookings.map(b => b._id) },
      type: { $in: ['payment', 'refund', 'owner_payout_completed'] }
    })
    .sort({ createdAt: -1 })
    .lean();

    const txEvents = transactions.map(t => ({
      eventType: 'finance',
      title: t.type === 'payment' ? 'Payment Verified' : (t.type === 'refund' ? 'Refund Processed' : 'Funds Disbursed'),
      description: `${t.direction.toUpperCase()} GH₵${t.amount} - Ref: ${t.reference}`,
      timestamp: t.createdAt,
      ownerId: oid,
      bookingId: t.booking,
      amount: t.amount,
      metadata: {
        type: t.type,
        reference: t.reference,
        status: t.status
      }
    }));

    /**
     * SOURCE 5: ADMIN AUDIT LOGS
     * Actions taken by admins targeting this owner or their hostels.
     */
    const auditLogs = await AdminAuditLog.find({
      $or: [
        { targetId: ownerId.toString(), targetType: 'User' },
        { targetId: { $in: hostelIds.map(id => id.toString()) }, targetType: 'Hostel' }
      ]
    })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .lean();

    const auditEvents = auditLogs.map(log => ({
      eventType: 'moderation',
      title: log.actionType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
      description: `Performed by ${log.admin ? log.admin.name : 'System'}${log.metadata?.reason ? ': ' + log.metadata.reason : ''}`,
      timestamp: log.createdAt,
      ownerId: oid,
      metadata: {
        adminName: log.admin?.name,
        targetType: log.targetType,
        severity: log.severity
      }
    }));

    /**
     * SOURCE 6: NOTIFICATIONS (Fallback for comms)
     */
    const notifications = await Notification.find({ user: oid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const notificationEvents = notifications.map(n => ({
      eventType: 'notification',
      title: n.title,
      description: n.message,
      timestamp: n.createdAt,
      ownerId: oid,
      metadata: {
        type: n.type,
        data: n.data
      }
    }));

    // UNIFY AND SORT
    let allEvents = [
      ...forensicEvents,
      ...bookingEvents,
      ...payoutEvents,
      ...txEvents,
      ...auditEvents,
      ...notificationEvents
    ];

    // Remove duplicates by a composite key if necessary, but here we want history
    allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const paginatedEvents = allEvents.slice(skip, skip + limit);

    return {
      events: paginatedEvents,
      pagination: {
        total: allEvents.length,
        page,
        limit,
        pages: Math.ceil(allEvents.length / limit)
      }
    };
  }
}

module.exports = new OwnerTimelineService();
