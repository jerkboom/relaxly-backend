const User = require('../models/User');
const Booking = require('../models/Booking');
const TransactionLedger = require('../models/TransactionLedger');
const AdminAuditLog = require('../models/AdminAuditLog');

class StudentService {
  /**
   * Get complete student profile with bookings, payments, refunds and timeline
   * @param {string} studentId 
   */
  async getStudentFullProfile(studentId) {
    // 1. Fetch Student with University
    const student = await User.findById(studentId)
      .populate({ path: 'university', select: 'name' })
      .select('-password');

    if (!student) {
      const error = new Error('Student not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // 2. Fetch all Bookings with complete population
    const bookings = await Booking.find({ student: studentId })
      .populate({
          path: 'hostel',
          select: 'name location owner',
          populate: { path: 'owner', select: 'name email phone' }
      })
      .populate('room', 'roomType roomNumber floorNumber occupancyStyle')
      .populate({
        path: 'checkedInBy',
        select: 'name email'
      })
      .populate({
        path: 'assignedById',
        select: 'name email'
      })
      .sort({ createdAt: -1 });

    // 3. Fetch Payments & Refunds (Transactions)
    const transactions = await TransactionLedger.find({
      $or: [{ sender: studentId }, { recipient: studentId }]
    }).sort({ createdAt: -1 });

    const payments = transactions.filter(t => t.type === 'payment' || t.type === 'booking_fee');
    const refunds = transactions.filter(t => t.type === 'refund');

    // 4. Room Assignments History (Physical Occupancy)
    const assignments = bookings
      .filter(b => b.assignedRoomNumber || b.room)
      .map(b => {
        const assignment = {
          _id: b._id,
          hostelName: b.hostel ? b.hostel.name : 'N/A',
          roomNumber: b.assignedRoomNumber || (b.room ? b.room.roomNumber : 'N/A'),
          floorNumber: b.assignedFloorNumber || (b.room ? b.room.floorNumber : 'N/A'),
          bedNumber: b.assignedBedNumber || 'N/A',
          block: b.assignedBlock || 'N/A',
          
          // Attribution
          assignedBy: b.assignedBy || (b.assignedById ? b.assignedById.name : 'System'),
          assignedById: b.assignedById ? b.assignedById._id : null,
          assignedAt: b.assignedAt || b.createdAt,
          
          // Check-in state
          checkedIn: b.checkedIn,
          checkedInAt: b.checkedInAt,
          checkedInByName: b.checkedInBy ? b.checkedInBy.name : (b.checkedIn ? 'System' : 'N/A'),
          
          status: b.bookingStatus,
          occupancyNotes: b.occupancyNotes
        };
        return assignment;
      });

    // 5. Generate Comprehensive Timeline
    const timeline = [];

    // - Account Creation
    timeline.push({
      event: 'ACCOUNT_CREATED',
      label: 'Account Created',
      date: student.createdAt,
      details: 'Student registered on the platform',
      type: 'system'
    });

    // - Booking Events
    bookings.forEach(b => {
      timeline.push({
        event: 'BOOKING_CREATED',
        label: 'Booking Created',
        date: b.createdAt,
        details: `Booking reference: ${b.bookingCode || b._id} at ${b.hostel ? b.hostel.name : 'Unknown Hostel'}`,
        type: 'booking'
      });

      if (b.history && Array.isArray(b.history)) {
        b.history.forEach(h => {
          timeline.push({
            event: h.event,
            label: h.event.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
            date: h.timestamp,
            details: h.details,
            type: 'booking_update'
          });
        });
      }
    });

    // - Transaction Events
    transactions.forEach(t => {
      timeline.push({
        event: `TX_${t.type.toUpperCase()}`,
        label: t.type.charAt(0).toUpperCase() + t.type.slice(1).replace('_', ' '),
        date: t.createdAt,
        details: `${t.status.toUpperCase()} - GH₵${t.amount}`,
        type: 'finance'
      });
    });

    // - Admin Actions (Activity Logs)
    const activityLogs = await AdminAuditLog.find({
      targetId: studentId.toString(),
      targetType: 'User'
    })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 });

    activityLogs.forEach(log => {
      timeline.push({
        event: log.actionType,
        label: log.actionType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
        date: log.createdAt,
        details: `Performed by ${log.admin ? log.admin.name : 'Admin'}${log.metadata && log.metadata.reason ? ': ' + log.metadata.reason : ''}`,
        type: 'admin'
      });
    });

    // Sort timeline by date descending
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 6. Calculate Stats
    const totalPaid = payments
      .filter(p => p.status === 'success' || p.status === 'completed')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
      
    const totalRefunds = refunds
      .filter(r => r.status === 'success' || r.status === 'completed')
      .reduce((sum, r) => sum + (r.amount || 0), 0);

    const stats = {
      totalBookings: bookings.length,
      activeReservations: bookings.filter(b => ['approved', 'pending', 'checked_in'].includes(b.bookingStatus)).length,
      completedReservations: bookings.filter(b => b.bookingStatus === 'completed').length,
      cancelledReservations: bookings.filter(b => b.bookingStatus === 'cancelled' || b.bookingStatus === 'rejected').length,
      totalPaid,
      totalRefunds,
      netSpending: totalPaid - totalRefunds
    };

    return {
      user: student, // Returning as 'user' as requested
      bookings,
      assignments,
      payments,
      refunds,
      timeline: timeline.slice(0, 50),
      activityLogs, // Separate array if needed by frontend
      stats,
      accommodationHistory: assignments // Alias for assignments
    };
  }
}

module.exports = new StudentService();
