const User = require('../models/User');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
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
    
    const users = await User.find(query).sort({ createdAt: -1 });
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
    const user = await User.findById(userId).select('-password');
    if (!user) {
      const error = new Error('User not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Determine if student or owner based on role/history
    const bookings = await Booking.find({ student: user._id })
      .populate('hostel', 'name location')
      .sort({ createdAt: -1 });

    const totalBookings = bookings.length;
    const successfulPayments = bookings.filter(b => b.paymentStatus === 'paid').length;
    const totalSpending = bookings.filter(b => b.paymentStatus === 'paid').reduce((sum, b) => sum + b.amount, 0);

    return {
      user,
      metrics: {
        totalBookings,
        successfulPayments,
        totalSpending,
        activeReservations: bookings.filter(b => b.bookingStatus === 'approved').length
      },
      bookings: bookings.slice(0, 10)
    };
  }

  async getStudentsForAdmin() {
    const students = await User.find({ role: 'student' })
      .populate('university', 'name')
      .sort({ createdAt: -1 });

    const studentData = await Promise.all(students.map(async (student) => {
      const bookingCount = await Booking.countDocuments({ student: student._id });
      return {
        _id: student._id,
        name: student.name,
        email: student.email,
        phone: student.phone || 'N/A',
        studentId: student.studentId || 'N/A',
        university: student.customUniversity || (student.university ? student.university.name : (student.schoolName || 'N/A')),
        bookingCount,
        createdAt: student.createdAt,
        status: student.accountStatus
      };
    }));

    return studentData;
  }

  async getOwnersForAdmin() {
    const owners = await User.find({ role: 'owner' }).sort({ createdAt: -1 });

    const ownerData = await Promise.all(owners.map(async (owner) => {
      const hostelCount = await Hostel.countDocuments({ owner: owner._id });
      
      const hostels = await Hostel.find({ owner: owner._id }, '_id');
      const hostelIds = hostels.map(h => h._id);
      
      const paidBookings = await Booking.find({ 
        hostel: { $in: hostelIds }, 
        paymentStatus: 'paid' 
      });
      
      const totalEarnings = paidBookings.reduce((sum, b) => sum + (b.ownerAmount || 0), 0);

      return {
        _id: owner._id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        hostelCount,
        earnings: totalEarnings,
        verificationStatus: owner.verificationStatus,
        joinedDate: owner.createdAt,
        status: owner.accountStatus
      };
    }));

    return ownerData;
  }
}

module.exports = new AdminUserService();
