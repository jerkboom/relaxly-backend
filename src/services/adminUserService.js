const User = require('../models/User');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const University = require('../models/University');
const { logAdminAction } = require('../utils/auditLogger');

class AdminUserService {
  /**
   * Get all users with filtering, sorting, and pagination
   */
  async getAllUsers(queryObj) {
    const { role, search, status } = queryObj;
    let query = {};
    
    if (role) query.role = String(role).toLowerCase();
    if (status) query.accountStatus = String(status).toLowerCase();
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const users = await User.find(query).populate({ path: 'university', select: 'name' }).sort({ createdAt: -1 });
    return users;
  }

  /**
   * Update user account status (suspended, deactivated, active)
   */
  async updateUserStatus(userId, status, reason, adminReq) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const normalizedStatus = String(status).toLowerCase();

    // SAFETY GUARDS
    if (user.role === 'super_admin' && normalizedStatus !== 'active') {
      throw new Error('Cannot suspend or ban a Super Admin account');
    }

    if (adminReq.user.id === user._id.toString() && normalizedStatus !== 'active') {
      throw new Error('Cannot suspend or ban your own account');
    }

    const oldStatus = user.accountStatus;
    user.accountStatus = normalizedStatus;
    await user.save();

    await logAdminAction({
      req: adminReq,
      actionType: normalizedStatus === 'suspended' ? 'USER_SUSPEND' : normalizedStatus === 'banned' ? 'USER_BAN' : 'USER_UNSUSPEND',
      targetType: 'User',
      targetId: user._id,
      metadata: { oldStatus, newStatus: normalizedStatus, reason }
    });

    return user;
  }

  /**
   * Update user role (RBAC)
   */
  async updateUserRole(userId, role, adminReq) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const oldRole = user.role;
    user.role = role;
    await user.save();

    await logAdminAction({
      req: adminReq,
      actionType: 'ROLE_UPDATE',
      targetType: 'User',
      targetId: user._id,
      metadata: { oldRole, newRole: role }
    });

    return user;
  }

  /**
   * Get detailed user profile and metrics
   */
  async getUserDetails(userId) {
    const User = require('../models/User');
    const Booking = require('../models/Booking');
    const TransactionLedger = require('../models/TransactionLedger');
    const AdminAuditLog = require('../models/AdminAuditLog');

    const user = await User.findById(userId)
      .select('-password')
      .populate({ path: 'university', select: 'name' });

    if (!user) {
      const error = new Error('User not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // 1. Fetch Bookings with full population
    const bookings = await Booking.find({ student: user._id })
      .populate('hostel', 'name location owner')
      .populate('room', 'roomType roomNumber')
      .sort({ createdAt: -1 });

    // 2. Fetch Payments & Potential Refunds (Transactions)
    const bookingIds = bookings.map(b => b._id);
    const transactions = await TransactionLedger.find({ 
      booking: { $in: bookingIds }
    }).sort({ createdAt: -1 });

    const payments = transactions.filter(t => t.type === 'payment' || t.type === 'booking_fee');
    const refunds = transactions.filter(t => t.type === 'refund');

    // 3. Room Assignments (from Bookings)
    const assignments = bookings
      .filter(b => b.assignedRoomNumber || b.room)
      .map(b => ({
        bookingId: b._id,
        hostel: b.hostel ? b.hostel.name : 'N/A',
        roomNumber: b.assignedRoomNumber || (b.room ? b.room.roomNumber : 'N/A'),
        bedNumber: b.assignedBedNumber || 'N/A',
        status: b.bookingStatus,
        checkInDate: b.checkInDate
      }));

    // 4. Activity Logs (Audit Logs where this user is the target)
    const activityLogs = await AdminAuditLog.find({ 
      targetId: user._id.toString(),
      targetType: 'User'
    })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 });

    // 5. Calculate Metrics
    const currentStay = bookings.find(b => b.bookingStatus === 'checked_in');
    const totalBookings = bookings.length;
    const successfulPayments = payments.filter(p => p.status === 'success' || p.status === 'completed').length;
    const totalSpending = payments
      .filter(p => p.status === 'success' || p.status === 'completed')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const stats = {
      totalBookings,
      activeReservations: bookings.filter(b => ['approved', 'pending'].includes(b.bookingStatus)).length,
      netSpending: totalSpending,
      pendingRefunds: refunds.filter(r => r.status === 'pending').length,
      isCheckedIn: !!currentStay
    };

    const response = {
      student: user,
      stats,
      bookings,
      payments,
      refunds,
      assignments,
      timeline: activityLogs
    };

    // TEMPORARY DEBUG LOGS
    console.log("--- STUDENT PROFILE TRACE START ---");
    console.log("Target User ID:", userId);
    console.log("Student Found:", user ? user.email : "NO");
    console.log("Bookings Count:", bookings.length);
    console.log("Payments Count:", payments.length);
    console.log("Refunds Count:", refunds.length);
    console.log("Assignments Count:", assignments.length);
    console.log("Activity Logs Count:", activityLogs.length);
    console.log("Final Stats:", stats);
    console.log("--- STUDENT PROFILE TRACE END ---");

    return response;
  }

  async getStudentsForAdmin(search) {
    let matchQuery = { role: 'student' };
    
    if (search) {
      // Find students whose room assignment matches
      const matchedBookings = await Booking.find({ 
        assignedRoomNumber: { $regex: search, $options: 'i' } 
      }, 'student').lean();
      
      const studentIdsByRoom = matchedBookings.map(b => b.student);

      matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { studentId: { $regex: search, $options: 'i' } },
        { _id: { $in: studentIdsByRoom } }
      ];
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'universities',
          localField: 'university',
          foreignField: '_id',
          as: 'universityData'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          let: { studentId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$student', '$$studentId'] } } },
            { $count: 'count' }
          ],
          as: 'bookingCountData'
        }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phone: 1,
          studentId: 1,
          customUniversity: 1,
          universityName: { $arrayElemAt: ['$universityData.name', 0] },
          schoolName: 1,
          bookingCount: { $ifNull: [ { $arrayElemAt: ['$bookingCountData.count', 0] }, 0 ] },
          createdAt: 1,
          accountStatus: 1
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    const results = await User.aggregate(pipeline);

    return results.map(student => ({
      _id: student._id,
      name: student.name,
      email: student.email,
      phone: student.phone || 'N/A',
      studentId: student.studentId || 'N/A',
      university: student.customUniversity || student.universityName || student.schoolName || 'N/A',
      bookingCount: student.bookingCount,
      createdAt: student.createdAt,
      status: student.accountStatus
    }));
  }

  async getOwnersForAdmin() {
    const pipeline = [
      { $match: { role: 'owner' } },
      {
        $lookup: {
          from: 'hostels',
          localField: '_id',
          foreignField: 'owner',
          as: 'hostelData'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          let: { hostelIds: '$hostelData._id' },
          pipeline: [
            {
              $match: {
                $and: [
                  { $expr: { $in: ['$hostel', '$$hostelIds'] } },
                  { paymentStatus: 'paid' }
                ]
              }
            },
            {
              $group: {
                _id: null,
                totalEarnings: { $sum: '$ownerAmount' }
              }
            }
          ],
          as: 'earningsData'
        }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phone: 1,
          hostelCount: { $size: '$hostelData' },
          earnings: { $ifNull: [{ $arrayElemAt: ['$earningsData.totalEarnings', 0] }, 0] },
          verificationStatus: 1,
          createdAt: 1,
          accountStatus: 1
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    const results = await User.aggregate(pipeline);

    return results.map(owner => ({
      _id: owner._id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      hostelCount: owner.hostelCount,
      earnings: owner.earnings,
      verificationStatus: owner.verificationStatus,
      joinedDate: owner.createdAt,
      status: owner.accountStatus
    }));
  }
}

module.exports = new AdminUserService();
