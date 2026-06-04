const financeAdminService = require('../services/financeAdminService');
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const PlatformSettings = require('../models/PlatformSettings');
const AdminAuditLog = require('../models/AdminAuditLog');
const Booking = require('../models/Booking');
const { sendSuccess } = require('../utils/responseHandler');
const { logAdminAction } = require('../utils/auditLogger');
const adminUserService = require('../services/adminUserService');
const hostelModerationService = require('../services/hostelModerationService');
const inviteCodeService = require('../services/inviteCodeService');
const bookingService = require('../services/bookingService');
const cache = require('../utils/cache');

// --- PLATFORM SETTINGS ---

const getPlatformSettings = asyncHandler(async (req, res) => {
  const cacheKey = 'platform_settings';
  const cached = cache.get(cacheKey);
  if (cached) {
    return sendSuccess(res, cached, 'Platform settings retrieved from cache');
  }

  const settings = await PlatformSettings.getSettings();
  cache.set(cacheKey, settings, 1800); // 30 minutes
  sendSuccess(res, settings);
});

const updatePlatformSettings = asyncHandler(async (req, res) => {
  const { 
    commissionRate, 
    commissionPercent,
    serviceFee, 
    serviceFeePercent,
    manualHostelApproval, 
    bookingExpirationMinutes, 
    autoApprovePayments, 
    roomTypeAdjustments,
    supportSettings
  } = req.body;
  
  let settings = await PlatformSettings.findOne();
  if (!settings) settings = await PlatformSettings.getSettings();

  if (commissionRate !== undefined) settings.commissionRate = commissionRate;
  if (commissionPercent !== undefined) settings.commissionPercent = commissionPercent;
  if (serviceFee !== undefined) settings.serviceFee = serviceFee;
  if (serviceFeePercent !== undefined) settings.serviceFeePercent = serviceFeePercent;
  if (manualHostelApproval !== undefined) settings.manualHostelApproval = manualHostelApproval;
  if (bookingExpirationMinutes !== undefined) settings.bookingExpirationMinutes = bookingExpirationMinutes;
  if (autoApprovePayments !== undefined) settings.autoApprovePayments = autoApprovePayments;
  
  if (roomTypeAdjustments !== undefined) {
    // Update Map correctly by iterating entries
    Object.entries(roomTypeAdjustments).forEach(([key, value]) => {
      settings.roomTypeAdjustments.set(key, Number(value) || 0);
    });
  }

  if (supportSettings !== undefined) {
    if (supportSettings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportSettings.email)) {
      res.status(400);
      throw new Error('Invalid support email format');
    }

    if (supportSettings.phone === '') {
      res.status(400);
      throw new Error('Support phone number cannot be empty');
    }

    if (supportSettings.whatsapp === '') {
      res.status(400);
      throw new Error('WhatsApp support number cannot be empty');
    }
    
    settings.supportSettings = {
      ...settings.supportSettings,
      ...supportSettings
    };
  }

  await settings.save();
  
  await logAdminAction({ 
    req, 
    actionType: 'SETTINGS_UPDATE', 
    targetType: 'PlatformSettings', 
    targetId: settings._id, 
    metadata: req.body 
  });
  
  // INVALIDATE CACHE
  cache.delete('platform_settings');
  cache.delete('public_platform_settings');
  
  sendSuccess(res, settings, 'Platform settings updated');
});

const updateMaintenanceMode = asyncHandler(async (req, res) => {
  const { maintenanceMode, maintenanceMessage } = req.body;
  
  if (maintenanceMode === undefined) {
    res.status(400);
    throw new Error('maintenanceMode field is required');
  }

  let settings = await PlatformSettings.findOne();
  if (!settings) settings = await PlatformSettings.getSettings();

  const previousState = settings.maintenanceMode;
  settings.maintenanceMode = maintenanceMode;
  if (maintenanceMessage !== undefined) {
    settings.maintenanceMessage = maintenanceMessage;
  }

  await settings.save();

  const socketManager = require('../utils/socketManager');
  socketManager.io?.emit('maintenance_update', {
    maintenanceMode: settings.maintenanceMode,
    message: settings.maintenanceMessage || 'Platform is currently under maintenance.'
  });

  await logAdminAction({
    req,
    actionType: maintenanceMode ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
    targetType: 'PlatformSettings',
    targetId: settings._id,
    severity: 'critical',
    metadata: {
      previousState,
      newState: maintenanceMode,
      message: maintenanceMessage
    }
  });

  // INVALIDATE CACHE
  cache.delete('platform_settings');
  cache.delete('public_platform_settings');

  sendSuccess(res, settings, `Maintenance mode ${maintenanceMode ? 'enabled' : 'disabled'}`);
});

// --- USER MANAGEMENT ---

const getAllUsers = asyncHandler(async (req, res) => {
  const users = await adminUserService.getAllUsers(req.query);
  sendSuccess(res, users);
});

const updateUserAccountStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const user = await adminUserService.updateUserStatus(req.params.id, status, reason, req);
  sendSuccess(res, user, `User account is now ${status}`);
});

const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const user = await adminUserService.updateUserRole(req.params.id, role, req);
  sendSuccess(res, user, `User role updated to ${role}`);
});

const getUserDetails = asyncHandler(async (req, res) => {
  const details = await adminUserService.getUserDetails(req.params.id);
  sendSuccess(res, details);
});

const updateOwnerCommission = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const user = await User.findById(req.params.id);
  if (!user || user.role !== 'owner') {
    res.status(404);
    throw new Error('Owner not found');
  }
  user.commissionRate = req.body.commissionRate;
  await user.save();
  await logAdminAction({ req, actionType: 'COMMISSION_OVERRIDE', targetType: 'User', targetId: user._id, metadata: { commissionRate: req.body.commissionRate } });
  sendSuccess(res, user, 'Commission updated');
});

const getOwnerPerformance = asyncHandler(async (req, res) => {
  const Hostel = require('../models/Hostel');
  const ownerId = req.params.id;
  const hostels = await Hostel.find({ owner: ownerId });
  const hostelIds = hostels.map(h => h._id);
  const bookings = await Booking.find({ hostel: { $in: hostelIds }, paymentStatus: 'paid' });
  const totalRevenue = bookings.reduce((sum, b) => sum + (b.ownerAmount || 0), 0);
  sendSuccess(res, {
    hostelsCount: hostels.length,
    activeHostels: hostels.filter(h => h.verificationStatus === 'approved').length,
    totalRevenue,
    hostels: hostels.map(h => ({ id: h._id, name: h.name, status: h.verificationStatus }))
  });
});

const auditService = require('../services/auditService');

// --- AUDIT LOGS ---

const getAdminAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.getAuditLogs(req.query);
  sendSuccess(res, result);
});

const getAuditLogDetail = asyncHandler(async (req, res) => {
  const log = await auditService.getLogById(req.params.id);
  sendSuccess(res, log);
});

const getAuditLogMetrics = asyncHandler(async (req, res) => {
  const metrics = await auditService.getAuditMetrics();
  sendSuccess(res, metrics);
});

const exportAuditLogs = asyncHandler(async (req, res) => {
  const csv = await auditService.exportToCSV(req.query);
  const fileName = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  res.status(200).send(csv);
});

const generateAuditPDF = asyncHandler(async (req, res) => {
  await auditService.generatePDFReport(res, req.query);
});

const getMyActivityLogs = asyncHandler(async (req, res) => {
  const actor = req.admin || req.user;
  if (!actor) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  const result = await auditService.getAdminActivity(actor._id || actor.id, req.query);
  sendSuccess(res, result);
});

const exportMyActivityLogs = asyncHandler(async (req, res) => {
  try {
    const actor = req.admin || req.user;
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const format = String(req.query.format || 'csv').toLowerCase();
    const date = new Date().toISOString().split('T')[0];
    const filename = `admin-audit-log-${date}.${format}`;
    const exportResult = await auditService.exportAdminActivity(actor._id || actor.id, format);

    res.setHeader('Content-Type', exportResult.contentType || 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    if (format === 'pdf') {
      const doc = new (require('pdfkit'))({ margin: 36, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(18).text('Relaxly Admin Activity Export', { align: 'center' });
      doc.moveDown();
      exportResult.body.forEach((row) => {
        if (doc.y > 730) doc.addPage();
        doc.fontSize(9).text(`${row.timestamp} | ${row.operation}`);
        doc.moveDown(0.5);
      });
      doc.end();
      return;
    }

    res.status(200).send(exportResult.body);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const getMyActivityLogDetail = asyncHandler(async (req, res) => {
  const actor = req.admin || req.user;
  const log = await auditService.getAdminActivityLogById(actor._id || actor.id, req.params.id);
  sendSuccess(res, log);
});

// --- DASHBOARD LISTS ---

const getAllHostelsForAdmin = asyncHandler(async (req, res) => {
  const hostels = await hostelModerationService.getAllHostels(req.query);
  const formattedHostels = hostels.map(h => ({
    _id: h._id,
    name: h.name,
    owner: h.owner,
    verificationStatus: h.verificationStatus,
    totalRooms: h.totalRooms,
    occupancy: h.totalRooms - h.availableRooms,
    createdAt: h.createdAt,
    status: h.verificationStatus
  }));
  sendSuccess(res, formattedHostels);
});

const getAllStudentsForAdmin = asyncHandler(async (req, res) => {
  const students = await adminUserService.getStudentsForAdmin();
  sendSuccess(res, students);
});

const getAllOwnersForAdmin = asyncHandler(async (req, res) => {
  const owners = await adminUserService.getOwnersForAdmin();
  sendSuccess(res, owners);
});

// --- HOSTEL MODERATION ---

const getPendingHostels = asyncHandler(async (req, res) => {
  const hostels = await hostelModerationService.getPendingHostels(req.query);
  sendSuccess(res, hostels);
});

const getModerationStats = asyncHandler(async (req, res) => {
  const stats = await hostelModerationService.getModerationStats();
  sendSuccess(res, stats);
});

const getSuspiciousHostels = asyncHandler(async (req, res) => {
  const hostels = await hostelModerationService.getSuspiciousHostels(req.query);
  sendSuccess(res, hostels);
});

const getModerationPolicies = asyncHandler(async (req, res) => {
  const policies = hostelModerationService.getModerationPolicies();
  sendSuccess(res, policies);
});

const approveHostel = asyncHandler(async (req, res) => {
  const hostel = await hostelModerationService.approveHostel(req.params.id, req);
  sendSuccess(res, hostel, 'Hostel approved');
});

const rejectHostel = asyncHandler(async (req, res) => {
  const hostel = await hostelModerationService.rejectHostel(req.params.id, req.body.notes, req);
  sendSuccess(res, hostel, 'Hostel rejected');
});

const suspendHostel = asyncHandler(async (req, res) => {
  const hostel = await hostelModerationService.suspendHostel(req.params.id, req.body.notes, req);
  sendSuccess(res, hostel, 'Hostel suspended');
});

// --- GENERAL BOOKINGS ---

const getAllBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({}).populate('student', 'name email').populate('hostel', 'name location').sort({ createdAt: -1 });
  sendSuccess(res, bookings);
});

// --- INVITE CODES ---

const generateInviteCode = asyncHandler(async (req, res) => {
  const { email, daysValid } = req.body;
  const invite = await inviteCodeService.generateCode(req.user.id, email, daysValid);
  await logAdminAction({ req, actionType: 'INVITE_GENERATE', targetType: 'OwnerInviteCode', targetId: invite._id, metadata: { email, daysValid } });
  sendSuccess(res, invite, 'Invite code generated successfully');
});

const getAllInviteCodes = asyncHandler(async (req, res) => {
  const codes = await inviteCodeService.getAllCodes();
  sendSuccess(res, codes);
});

const revokeInviteCode = asyncHandler(async (req, res) => {
  await inviteCodeService.revokeCode(req.params.id);
  await logAdminAction({ req, actionType: 'INVITE_REVOKE', targetType: 'OwnerInviteCode', targetId: req.params.id });
  sendSuccess(res, null, 'Invite code revoked');
});

// --- BOOKING ACTIONS ---
const approveBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.approveBooking(req.params.id, req.user.id, req);
  await logAdminAction({ req, actionType: 'BOOKING_APPROVE', targetType: 'Booking', targetId: booking._id });
  sendSuccess(res, booking, 'Booking approved');
});
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBooking(req.params.id, req.user.id);
  await logAdminAction({ req, actionType: 'BOOKING_CANCEL', targetType: 'Booking', targetId: booking._id });
  sendSuccess(res, booking, 'Booking cancelled');
});
const markBookingPaid = asyncHandler(async (req, res) => {
  const booking = await bookingService.markBookingAsPaid(req.params.id, req.user.id);
  await logAdminAction({ req, actionType: 'BOOKING_MARK_PAID', targetType: 'Booking', targetId: booking._id });
  sendSuccess(res, booking, 'Booking marked as paid');
});

// --- FINANCE ---
const getFinanceOverview = asyncHandler(async (req, res) => {
  const data = await financeAdminService.getFinanceSummary();
  sendSuccess(res, data);
});

const getFinanceLedger = asyncHandler(async (req, res) => {
  const ledger = await financeAdminService.getTransactionLedger(req.query);
  sendSuccess(res, ledger);
});
const getFinancePayouts = asyncHandler(async (req, res) => {
  const queue = await financeAdminService.getPayoutQueue(req.query);
  sendSuccess(res, queue);
});

// --- ANALYTICS ---
const getAnalyticsOverview = asyncHandler(async (req, res) => {
  const { timeframe } = req.query;

  const cacheKey = `admin_dashboard_analytics_${timeframe || '30days'}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return sendSuccess(res, cached, 'Admin analytics retrieved from cache');
  }

  const User = require('../models/User');
  const Hostel = require('../models/Hostel');
  const PayoutQueue = require('../models/PayoutQueue');
  
  let startDate = new Date();
  if (timeframe === 'today') startDate.setHours(0, 0, 0, 0);
  else if (timeframe === 'last7days') startDate.setDate(startDate.getDate() - 7);
  else if (timeframe === 'last12months') startDate.setMonth(startDate.getMonth() - 12);
  else startDate.setDate(startDate.getDate() - 30);

  const dateFilter = { createdAt: { $gte: startDate } };
  
  const [
    totalStudents, totalOwners,
    totalHostels, verifiedHostels, pendingHostels,
    totalBookings, activeBookings, completedBookings, pendingBookings, cancelledBookings,
    totalRevenueAgg, pendingPayoutsAgg,
    revenueChart
  ] = await Promise.all([
    User.countDocuments({ role: 'student', accountStatus: 'active' }),
    User.countDocuments({ role: 'owner', accountStatus: 'active' }),
    Hostel.countDocuments({}),
    Hostel.countDocuments({ verificationStatus: 'approved' }),
    Hostel.countDocuments({ verificationStatus: 'pending' }),
    Booking.countDocuments(dateFilter),
    Booking.countDocuments({ ...dateFilter, bookingStatus: 'approved' }),
    Booking.countDocuments({ ...dateFilter, bookingStatus: 'completed' }),
    Booking.countDocuments({ ...dateFilter, bookingStatus: 'pending' }),
    Booking.countDocuments({ ...dateFilter, bookingStatus: 'cancelled' }),
    Booking.aggregate([
      { $match: { ...dateFilter, paymentStatus: 'paid' } },
      { $group: { 
          _id: null, 
          total: { $sum: { $ifNull: ['$platformGrossRevenue', '$totalPaid'] } },
          netProfit: { $sum: { $ifNull: ['$platformNetProfit', '$adminCommission'] } },
          taxReserve: { $sum: { $ifNull: ['$taxReserve', 0] } },
          retainedProfit: { $sum: { $ifNull: ['$platformFinalRetainedProfit', '$adminCommission'] } }
        } 
      }
    ]),
    PayoutQueue.aggregate([
      { $match: { ...dateFilter, status: { $in: ['pending', 'processing', 'approved', 'otp_pending'] } } },
      { $group: { _id: null, total: { $sum: '$finalTransferAmount' } } }
    ]),
    Booking.aggregate([
      { $match: { ...dateFilter, paymentStatus: 'paid' } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: '$totalPaid' }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  const responseData = {
    users: { totalStudents, totalOwners },
    hostels: { totalHostels, verifiedHostels, pendingHostels },
    bookings: { totalBookings, active: activeBookings, completed: completedBookings, pending: pendingBookings, cancelled: cancelledBookings },
    finance: { 
      totalRevenue: totalRevenueAgg[0]?.total || 0,
      totalNetProfit: totalRevenueAgg[0]?.netProfit || 0,
      totalTaxReserve: totalRevenueAgg[0]?.taxReserve || 0,
      totalRetainedProfit: totalRevenueAgg[0]?.retainedProfit || 0,
      pendingPayouts: pendingPayoutsAgg[0]?.total || 0,
      successfulPayments: activeBookings + completedBookings, 
      failedPayments: cancelledBookings 
    },
    conversionRate: totalBookings > 0 ? Math.round(((activeBookings + completedBookings) / totalBookings) * 1000) / 10 : 0,
    revenueChart: revenueChart.map(item => ({ date: item._id, revenue: item.revenue })),
    activeSessions: 1
  };

  // CACHE DATA
  cache.set(cacheKey, responseData, 60); // 60 seconds

  sendSuccess(res, responseData);
});

const getAnalyticsRevenueChart = asyncHandler(async (req, res) => { sendSuccess(res, []); });
const getAnalyticsTopHostels = asyncHandler(async (req, res) => { sendSuccess(res, []); });

// --- PUBLIC SETTINGS ---
const getPublicSettings = asyncHandler(async (req, res) => {
  const cacheKey = 'public_platform_settings';
  const cached = cache.get(cacheKey);
  if (cached) {
    return sendSuccess(res, cached, 'Public settings retrieved from cache');
  }

  try {
    const settings = await PlatformSettings.getSettings();
    const responseData = {
      serviceFee: settings?.serviceFee ?? 10,
      serviceFeePercent: settings?.serviceFeePercent ?? 0,
      maintenanceMode: settings?.maintenanceMode ?? false,
      maintenanceMessage: settings?.maintenanceMessage || 'Platform is currently under maintenance.',
      roomTypeAdjustments: settings?.roomTypeAdjustments || {},
      supportSettings: settings?.supportSettings || {
        email: 'support@relaxly.com',
        phone: '+233 XX XXX XXXX',
        whatsapp: '+233XXXXXXXXX'
      }
    };

    cache.set(cacheKey, responseData, 1800); // 30 minutes
    sendSuccess(res, responseData);
  } catch (error) {
    sendSuccess(res, {
      serviceFee: 10,
      serviceFeePercent: 0,
      maintenanceMode: false,
      maintenanceMessage: 'Platform is currently under maintenance.',
      roomTypeAdjustments: {},
      supportSettings: { email: 'support@relaxly.com', phone: '+233 XX XXX XXXX', whatsapp: '+233XXXXXXXXX' }
    });
  }
});

// --- ADMIN PROFILE ---

const getAdminProfile = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admin = await Admin.findById(req.user.id).select('+password');
  if (!admin) { res.status(404); throw new Error('Admin not found'); }
  sendSuccess(res, admin);
});

const updateAdminProfile = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admin = await Admin.findById(req.user.id);
  if (!admin) { res.status(404); throw new Error('Admin not found'); }
  admin.name = req.body.name || admin.name;
  admin.email = req.body.email || admin.email;
  await admin.save();
  await logAdminAction({ req, actionType: 'PROFILE_UPDATE', targetType: 'Admin', targetId: admin._id, metadata: { updatedFields: Object.keys(req.body) } });
  sendSuccess(res, admin, 'Profile updated');
});

const updateAdminPassword = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const { currentPassword, newPassword } = req.body;
  const admin = await Admin.findById(req.user.id).select('+password');
  if (!admin || !(await admin.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error('Invalid current password');
  }
  admin.password = newPassword;
  await admin.save();
  await logAdminAction({ req, actionType: 'PASSWORD_CHANGE', targetType: 'Admin', targetId: admin._id });
  sendSuccess(res, null, 'Password updated successfully');
});

const toggleAdminMfa = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admin = await Admin.findById(req.user.id);
  admin.mfaEnabled = req.body.enabled;
  await admin.save();
  await logAdminAction({ req, actionType: 'MFA_TOGGLE', targetType: 'Admin', targetId: admin._id, metadata: { enabled: req.body.enabled } });
  sendSuccess(res, admin, `MFA ${req.body.enabled ? 'enabled' : 'disabled'} successfully`);
});

const loginAdmin = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');
  if (!admin || !(await admin.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
  }
  const token = jwt.sign({ id: admin._id, role: admin.role, authType: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  sendSuccess(res, { token, user: admin });
});

const inviteAdmin = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const { email, role, name } = req.body;
  const password = req.body.password || 'TemporaryPassword123!';
  const admin = new Admin({ name: name || email.split('@')[0], email, password, role, status: 'active', isActive: true });
  await admin.save();
  await logAdminAction({ req, actionType: 'ADMIN_PROVISION', targetType: 'Admin', targetId: admin._id, metadata: { role } });
  sendSuccess(res, admin, 'Admin invitation sent', 201);
});

const activateAdmin = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const Admin = require('../models/Admin');
  const crypto = require('crypto');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const admin = await Admin.findOne({ activationToken: hashedToken, activationExpires: { $gt: Date.now() } });
  if (!admin) { res.status(400); throw new Error('Invalid token'); }
  admin.isActive = true; admin.status = 'active'; await admin.save();
  sendSuccess(res, null, 'Account activated');
});

const getProvisionedAdmins = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admins = await Admin.find({});
  sendSuccess(res, admins);
});

const updateProvisionedAdminRole = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admin = await Admin.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true });
  sendSuccess(res, admin, 'Role updated');
});

const updateProvisionedAdminStatus = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  const admin = await Admin.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  sendSuccess(res, admin, 'Status updated');
});

const deleteProvisionedAdmin = asyncHandler(async (req, res) => {
  const Admin = require('../models/Admin');
  await Admin.findByIdAndDelete(req.params.id);
  sendSuccess(res, null, 'Admin deleted');
});

const getAdmins = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const admins = await User.find({ role: { $in: ['super_admin', 'finance_admin', 'support_admin', 'verification_admin', 'admin', 'moderator'] } }).select('-password');
  sendSuccess(res, admins);
});

const createAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  const User = require('../models/User');
  const admin = await User.create({ name, email, password, role });
  sendSuccess(res, admin, 'Admin created', 201);
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  await User.findByIdAndDelete(req.params.id);
  sendSuccess(res, null, 'Admin deleted');
});

const getSystemHealth = asyncHandler(async (req, res) => {
  sendSuccess(res, { uptime: process.uptime(), memory: process.memoryUsage() });
});

const getFraudMonitoring = asyncHandler(async (req, res) => {
  sendSuccess(res, { status: 'nominal' });
});

const getLiveActivityFeed = asyncHandler(async (req, res) => {
  sendSuccess(res, []);
});

const getCacheStats = asyncHandler(async (req, res) => {
  const stats = cache.getStats();
  sendSuccess(res, stats, 'Cache statistics retrieved');
});

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
  updateMaintenanceMode,
  getAllUsers,
  updateUserAccountStatus,
  updateUserRole,
  getUserDetails,
  updateOwnerCommission,
  getOwnerPerformance,
  getAdminAuditLogs,
  getAuditLogDetail,
  getAuditLogMetrics,
  exportAuditLogs,
  generateAuditPDF,
  getMyActivityLogs,
  exportMyActivityLogs,
  getMyActivityLogDetail,
  getAllHostelsForAdmin,
  getAllStudentsForAdmin,
  getAllOwnersForAdmin,
  getPendingHostels,
  getModerationStats,
  getSuspiciousHostels,
  getModerationPolicies,
  approveHostel,
  rejectHostel,
  suspendHostel,
  getAllBookings,
  generateInviteCode,
  getAllInviteCodes,
  revokeInviteCode,
  approveBooking,
  cancelBooking,
  markBookingPaid,
  getFinanceOverview,
  getFinanceLedger,
  getFinancePayouts,
  getAnalyticsOverview,
  getAnalyticsRevenueChart,
  getAnalyticsTopHostels,
  getPublicSettings,
  getAdminProfile,
  updateAdminProfile,
  updateAdminPassword,
  toggleAdminMfa,
  loginAdmin,
  inviteAdmin,
  activateAdmin,
  getProvisionedAdmins,
  updateProvisionedAdminRole,
  updateProvisionedAdminStatus,
  deleteProvisionedAdmin,
  getAdmins,
  createAdmin,
  deleteAdmin,
  getSystemHealth,
  getFraudMonitoring,
  getLiveActivityFeed,
  getCacheStats
};
