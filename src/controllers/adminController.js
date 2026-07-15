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
  const { search } = req.query;
  const students = await adminUserService.getStudentsForAdmin(search);
  sendSuccess(res, students);
});

const getAllOwnersForAdmin = asyncHandler(async (req, res) => {
  const owners = await adminUserService.getOwnersForAdmin();
  sendSuccess(res, owners);
});

// --- CUSTOM UNIVERSITIES REPORT ---
const getCustomUniversities = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const users = await User.find({ role: 'student', customUniversity: { $ne: null } })
    .select('name email customUniversity createdAt')
    .sort({ createdAt: -1 });

  const report = users.map(u => ({
    student: u.name,
    email: u.email,
    universityEntered: u.customUniversity,
    submittedAt: u.createdAt
  }));

  sendSuccess(res, report, 'Custom universities report retrieved');
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
      },
      duplicateBookingWindowMs: parseInt(process.env.DUPLICATE_BOOKING_WINDOW_MS, 10) || 20 * 24 * 60 * 60 * 1000
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
      supportSettings: { email: 'support@relaxly.com', phone: '+233 XX XXX XXXX', whatsapp: '+233XXXXXXXXX' },
      duplicateBookingWindowMs: parseInt(process.env.DUPLICATE_BOOKING_WINDOW_MS, 10) || 20 * 24 * 60 * 60 * 1000
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
  const crypto = require('crypto');
  const { email, role, name } = req.body;

  // Use a caller-supplied password or generate a cryptographically random one.
  // Either way, mustResetPassword is set so the admin must change it on first login.
  const tempPassword = req.body.password || crypto.randomBytes(16).toString('hex');

  const admin = new Admin({
    name: name || email.split('@')[0],
    email,
    password: tempPassword,
    role,
    status: 'active',
    isActive: true,
    mustResetPassword: true,
  });
  await admin.save();
  await logAdminAction({ req, actionType: 'ADMIN_PROVISION', targetType: 'Admin', targetId: admin._id, metadata: { role } });

  // Return the temp password so the caller can relay it via the invitation email.
  // The password hash is already stored; this plain value is not persisted.
  sendSuccess(res, { admin, tempPassword }, 'Admin invitation sent', 201);
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

const getNotificationMetrics = asyncHandler(async (req, res) => {
  const Notification = require('../models/Notification');
  const EmailLog = require('../models/EmailLog');
  const DeliveryLog = require('../models/DeliveryLog');
  const CommunicationQueue = require('../models/CommunicationQueue');
  const NotificationMetric = require('../models/NotificationMetric');

  const [
    notificationsSent,
    emailsDelivered,
    failedEmails,
    queueBacklog,
    webhookFailuresToday
  ] = await Promise.all([
    Notification.countDocuments(),
    EmailLog.countDocuments({ status: { $in: ['sent', 'delivered'] } }),
    EmailLog.countDocuments({ status: 'failed' }),
    CommunicationQueue.countDocuments({ status: { $in: ['PENDING', 'PROCESSING'] } }),
    Notification.countDocuments({
      type: 'system',
      notificationKey: { $regex: '^paystack_webhook:' },
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    })
  ]);

  const skippedDoc = await NotificationMetric.findOne({ key: 'skipped_duplicates' });
  const skippedDuplicates = skippedDoc ? skippedDoc.value : 0;

  // Average delivery time calculation
  const deliveryLogs = await DeliveryLog.find({
    status: 'DELIVERED',
    sentAt: { $exists: true },
    deliveredAt: { $exists: true }
  }).select('sentAt deliveredAt');

  let totalTime = 0;
  let count = 0;
  for (const log of deliveryLogs) {
    const diff = log.deliveredAt - log.sentAt;
    if (diff > 0) {
      totalTime += diff;
      count++;
    }
  }
  const avgDeliveryTimeSec = count > 0 ? Number((totalTime / count / 1000).toFixed(2)) : 0;

  sendSuccess(res, {
    notificationsSent,
    emailsDelivered,
    failedEmails,
    skippedDuplicates,
    avgDeliveryTimeSec,
    queueBacklog,
    webhookFailuresToday
  }, 'Notification metrics retrieved successfully');
});

const ownerTimelineService = require('../services/ownerTimelineService');

/**
 * @desc    Get aggregated activity timeline for a specific owner
 * @route   GET /api/admin/owners/:id/timeline
 * @access  Private/Admin
 */
const getOwnerTimeline = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page, limit } = req.query;

  const timeline = await ownerTimelineService.getOwnerTimeline(
    id,
    page ? parseInt(page) : 1,
    limit ? parseInt(limit) : 20
  );

  sendSuccess(res, timeline, 'Owner activity timeline retrieved successfully');
});

const updateSupportSettings = asyncHandler(async (req, res) => {
  const PlatformSettings = require('../models/PlatformSettings');
  const settings = await PlatformSettings.getSettings();
  
  if (req.body.whatsapp) {
    settings.supportSettings.whatsapp = {
      ...settings.supportSettings.whatsapp,
      ...req.body.whatsapp
    };
  }
  if (req.body.email) {
    settings.supportSettings.email = {
      ...settings.supportSettings.email,
      ...req.body.email
    };
  }
  if (req.body.workingHours) {
    if (req.body.workingHours.timezone) {
      settings.supportSettings.workingHours.timezone = req.body.workingHours.timezone;
    }
    if (req.body.workingHours.weekdays) {
      settings.supportSettings.workingHours.weekdays = {
        ...settings.supportSettings.workingHours.weekdays,
        ...req.body.workingHours.weekdays
      };
    }
    if (req.body.workingHours.weekend) {
      settings.supportSettings.workingHours.weekend = {
        ...settings.supportSettings.workingHours.weekend,
        ...req.body.workingHours.weekend
      };
    }
  }

  await settings.save();
  sendSuccess(res, settings.supportSettings, 'Support settings updated successfully');
});

const getAllAmbassadors = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const ambassadorService = require('../services/ambassadorService');
  
  const ambassadors = await User.find({
    $or: [
      { isAmbassador: true },
      { 'ambassadorProfile.referralCode': { $exists: true } },
      { ambassadorStatus: { $in: ['pending', 'approved', 'rejected', 'suspended'] } }
    ]
  }).select('-password').sort({ createdAt: -1 });

  const populated = await Promise.all(ambassadors.map(async (user) => {
    const wallet = await ambassadorService.getAmbassadorWalletDetails(user._id);
    return {
      ...user.toObject(),
      bookingsCount: wallet.successfulBookings,
      lifetimeEarnings: wallet.totalLifetimeEarnings,
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      totalReferrals: wallet.totalReferrals,
      pendingCommission: wallet.pendingCommission,
      paidBalance: wallet.paidBalance
    };
  }));

  sendSuccess(res, populated, 'Ambassadors retrieved successfully');
});

const approveAmbassador = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const { internalNotes } = req.body;
  const user = await ambassadorService.approveAmbassador(req.params.id, req.user.id, internalNotes);
  sendSuccess(res, user, 'Ambassador application approved successfully');
});

const rejectAmbassador = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const { reason, internalNotes } = req.body;
  if (!reason || !reason.trim()) {
    res.status(400);
    throw new Error('A rejection reason is required.');
  }
  const user = await ambassadorService.rejectAmbassador(req.params.id, req.user.id, reason, internalNotes);
  sendSuccess(res, user, 'Ambassador application rejected successfully');
});

const suspendAmbassador = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const { reason } = req.body;
  const user = await ambassadorService.suspendAmbassador(req.params.id, req.user.id, reason);
  sendSuccess(res, user, 'Ambassador suspended successfully');
});

const getAllAmbassadorPayouts = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const payouts = await ambassadorService.getAllPayoutRequests();
  sendSuccess(res, payouts, 'Ambassador payout requests retrieved successfully');
});

const reviewAmbassadorPayout = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const { status, note, otp } = req.body;
  
  let payout;
  if (status === 'otp_verify') {
    payout = await ambassadorService.finalizeAmbassadorTransferOtp(req.params.id, otp, req.user.id, req);
  } else {
    payout = await ambassadorService.reviewPayoutRequest(req.params.id, status, req.user.id, note);
  }
  sendSuccess(res, payout, 'Ambassador payout request reviewed successfully');
});

const getAmbassadorCommissionSettings = asyncHandler(async (req, res) => {
  const PlatformSettings = require('../models/PlatformSettings');
  const settings = await PlatformSettings.getSettings();
  sendSuccess(res, {
    ambassadorCommissionType: settings.ambassadorCommissionType || 'flat',
    ambassadorCommissionValue: settings.ambassadorCommissionValue || 30,
    ambassadorMinPayoutAmount: settings.ambassadorMinPayoutAmount || 100
  }, 'Ambassador commission settings retrieved successfully');
});

const updateAmbassadorCommissionSettings = asyncHandler(async (req, res) => {
  const PlatformSettings = require('../models/PlatformSettings');
  const settings = await PlatformSettings.getSettings();
  
  if (req.body.ambassadorCommissionType) {
    settings.ambassadorCommissionType = req.body.ambassadorCommissionType;
  }
  if (req.body.ambassadorCommissionValue !== undefined) {
    settings.ambassadorCommissionValue = req.body.ambassadorCommissionValue;
  }
  if (req.body.ambassadorMinPayoutAmount !== undefined) {
    settings.ambassadorMinPayoutAmount = req.body.ambassadorMinPayoutAmount;
  }
  
  await settings.save();
  sendSuccess(res, {
    ambassadorCommissionType: settings.ambassadorCommissionType,
    ambassadorCommissionValue: settings.ambassadorCommissionValue,
    ambassadorMinPayoutAmount: settings.ambassadorMinPayoutAmount
  }, 'Ambassador commission settings updated successfully');
});

const getAmbassadorFinanceOverview = asyncHandler(async (req, res) => {
  const ambassadorService = require('../services/ambassadorService');
  const overview = await ambassadorService.getFinanceOverview();
  sendSuccess(res, overview, 'Ambassador finance overview retrieved successfully');
});

const getAllReferrals = asyncHandler(async (req, res) => {
  const AmbassadorBooking = require('../models/AmbassadorBooking');
  const referrals = await AmbassadorBooking.find()
    .populate('ambassador', 'name email')
    .populate('referredStudent', 'name email')
    .populate('hostel', 'name')
    .populate('booking', 'bookingCode status paymentStatus')
    .sort({ createdAt: -1 });

  sendSuccess(res, referrals, 'Referral history retrieved successfully');
});

const getAmbassadorTimeline = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const User = require('../models/User');
  const AmbassadorBooking = require('../models/AmbassadorBooking');
  const PayoutQueue = require('../models/PayoutQueue');

  const user = await User.findById(id);
  if (!user) {
    res.status(404);
    throw new Error('Ambassador not found');
  }

  const timelineEvents = [];

  // 1. Application/Join
  if (user.createdAt) {
    timelineEvents.push({
      type: 'applied',
      title: 'Application Submitted',
      description: `Applied for campus ambassador from ${user.ambassadorProfile?.university || 'Unspecified'}`,
      date: user.createdAt
    });
  }
  if (user.ambassadorProfile?.reviewedAt) {
    timelineEvents.push({
      type: user.ambassadorStatus === 'approved' ? 'approved' : 'rejected',
      title: user.ambassadorStatus === 'approved' ? 'Application Approved' : 'Application Rejected',
      description: user.ambassadorStatus === 'approved' 
        ? 'Approved as campus ambassador.' 
        : `Rejection reason: ${user.ambassadorProfile?.rejectionReason || 'N/A'}`,
      date: user.ambassadorProfile.reviewedAt
    });
  }

  // 2. Referrals & Commissions
  const referrals = await AmbassadorBooking.find({ ambassador: id }).populate('referredStudent', 'name');
  for (const ref of referrals) {
    timelineEvents.push({
      type: 'referral_created',
      title: 'Referral Registered',
      description: `Referred student ${ref.referredStudent?.name || 'Student'} for hostel booking.`,
      date: ref.createdAt
    });
    if (ref.status === 'approved' || ref.status === 'paid') {
      timelineEvents.push({
        type: 'commission_earned',
        title: 'Commission Earned',
        description: `Earned commission of GHS ${ref.commissionAmount} for booking approval.`,
        date: ref.paidAt || ref.updatedAt
      });
    }
    if (ref.status === 'cancelled') {
      timelineEvents.push({
        type: 'referral_cancelled',
        title: 'Referral Cancelled',
        description: `Referral was cancelled. Any pending commission was revoked.`,
        date: ref.updatedAt
      });
    }
  }

  // 3. Payouts
  const payouts = await PayoutQueue.find({ owner: id, payoutType: 'ambassador' });
  for (const pay of payouts) {
    timelineEvents.push({
      type: 'payout_requested',
      title: 'Payout Requested',
      description: `Requested a payout of GHS ${pay.amount} via ${pay.transferMethod.toUpperCase()}`,
      date: pay.createdAt
    });
    if (pay.status === 'paid') {
      timelineEvents.push({
        type: 'payout_paid',
        title: 'Payout Completed',
        description: `Disbursed GHS ${pay.amount} via ${pay.transferMethod.toUpperCase()} (Ref: ${pay.transferReference || 'N/A'})`,
        date: pay.processedAt || pay.updatedAt
      });
    }
    if (pay.status === 'failed') {
      timelineEvents.push({
        type: 'payout_failed',
        title: 'Payout Failed',
        description: `Payout attempt failed. Reason: ${pay.failureReason || 'N/A'}`,
        date: pay.updatedAt
      });
    }
  }

  // Sort timeline by date descending
  timelineEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  sendSuccess(res, timelineEvents, 'Timeline events retrieved successfully');
});

// @desc    Sync leaderboard scoreboard without resetting data
// @route   POST /api/admin/ambassadors/leaderboard/sync
// @access  Private/Admin
const syncLeaderboard = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const ambassadorService = require('../services/ambassadorService');

  const ambassadors = await User.find({
    isAmbassador: true,
    ambassadorStatus: 'approved'
  });

  const leaderboard = await Promise.all(ambassadors.map(async (user) => {
    const wallet = await ambassadorService.getAmbassadorWalletDetails(user._id);
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      university: user.ambassadorProfile?.university || 'Accra Technical University',
      referralCode: user.ambassadorProfile?.referralCode || '',
      bookingsCount: wallet.successfulBookings,
      lifetimeEarnings: wallet.totalLifetimeEarnings,
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      totalReferrals: wallet.totalReferrals,
      pendingCommission: wallet.pendingCommission,
      paidBalance: wallet.paidBalance,
      badge: user.ambassadorProfile?.badge || 'bronze'
    };
  }));

  // Sort by bookingsCount desc
  leaderboard.sort((a, b) => b.bookingsCount - a.bookingsCount);

  // Assign ranks
  leaderboard.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  sendSuccess(res, leaderboard, 'Leaderboard synced successfully');
});

// @desc    Reset seasonal rankings for ambassadors
// @route   POST /api/admin/ambassadors/reset-season
// @access  Private/SuperAdmin
const resetSeason = asyncHandler(async (req, res) => {
  const User = require('../models/User');

  await User.updateMany(
    { isAmbassador: true },
    {
      $set: {
        "ambassadorProfile.seasonBookings": 0,
        "ambassadorProfile.seasonCommission": 0,
        "ambassadorProfile.seasonRank": null,
        "ambassadorProfile.seasonReferralCount": 0
      }
    }
  );

  sendSuccess(res, null, 'Season reset successfully.');
});

// @desc    Upload new marketing asset
// @route   POST /api/admin/ambassadors/marketing-assets
// @access  Private/MarketingAdmin
const uploadMarketingAsset = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  const { uploadToCloudinary } = require('../middleware/uploadMiddleware');
  
  console.log('[DEBUG] uploadMarketingAsset req.file:', req.file);
  console.log('[DEBUG] uploadMarketingAsset req.body:', req.body);
  
  const { title, description, category, targetUniversities, targetBadges, status, expiryDate } = req.body;

  if (!title || !category) {
    res.status(400);
    throw new Error('Title and category are required.');
  }

  let fileUrl = req.body.fileUrl;
  let publicId = '';
  let fileSize = Number(req.body.fileSize) || 0;
  let fileType = req.body.fileType || 'application/octet-stream';

  if (req.file) {
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const uploadResult = await uploadToCloudinary(req.file.buffer, req.file.originalname);
      fileUrl = uploadResult.secure_url || uploadResult.url;
      publicId = uploadResult.public_id;
      fileSize = uploadResult.bytes || req.file.size;
      fileType = req.file.mimetype;
    } else {
      const relativeUrl = '/uploads/' + req.file.filename;
      fileUrl = req.protocol + '://' + req.get('host') + relativeUrl;
      publicId = req.file.filename;
      fileSize = req.file.size;
      fileType = req.file.mimetype;
    }
  }

  if (!fileUrl) {
    res.status(400);
    throw new Error('Please select a file to upload.');
  }

  let parsedUnis = targetUniversities;
  if (typeof targetUniversities === 'string') {
    parsedUnis = targetUniversities.split(',').map(s => s.trim()).filter(Boolean);
  }
  let parsedBadges = targetBadges;
  if (typeof targetBadges === 'string') {
    parsedBadges = targetBadges.split(',').map(s => s.trim()).filter(Boolean);
  }

  const asset = await MarketingAsset.create({
    title,
    description,
    category,
    fileUrl,
    publicId,
    fileSize,
    fileType,
    targetUniversities: parsedUnis || [],
    targetBadges: parsedBadges || [],
    status: status || 'published',
    expiryDate: expiryDate ? new Date(new Date(expiryDate).setUTCHours(23, 59, 59, 999)) : null,
    uploadedBy: req.user.id,
    versions: [
      {
        versionNumber: 1,
        fileUrl,
        publicId,
        fileSize,
        fileType,
        uploadedBy: req.user.id,
        createdAt: new Date()
      }
    ]
  });

  if (asset.status === 'published') {
    const User = require('../models/User');
    const { createNotification } = require('../services/notificationService');
    const ambassadors = await User.find({ isAmbassador: true, ambassadorStatus: 'approved' });
    for (const amb of ambassadors) {
      const matchesUni = !asset.targetUniversities || asset.targetUniversities.length === 0 || 
        (amb.ambassadorProfile?.university && asset.targetUniversities.includes(amb.ambassadorProfile.university));
      const matchesBadge = !asset.targetBadges || asset.targetBadges.length === 0 || 
        (amb.ambassadorProfile?.badge && asset.targetBadges.includes(amb.ambassadorProfile.badge));

      if (matchesUni && matchesBadge) {
        await createNotification({
          user: amb._id,
          title: '📣 New promo material available!',
          message: `Download the new "${asset.title}" resource from your Marketing tab now.`,
          type: 'system'
        });
      }
    }
  }

  sendSuccess(res, asset, 'Promotional asset published successfully', 201);
});

const getMarketingAssetsAdmin = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');

  const now = new Date();
  await MarketingAsset.updateMany(
    { status: 'published', expiryDate: { $lt: now } },
    { $set: { status: 'archived' } }
  );

  const assets = await MarketingAsset.find()
    .populate('uploadedBy', 'name')
    .sort({ createdAt: -1 });

  sendSuccess(res, assets, 'Promotional assets retrieved successfully');
});

const updateMarketingAsset = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  const { uploadToCloudinary } = require('../middleware/uploadMiddleware');
  const { id } = req.params;

  const asset = await MarketingAsset.findById(id);
  if (!asset) {
    res.status(404);
    throw new Error('Marketing asset not found');
  }

  console.log('[DEBUG] updateMarketingAsset req.file:', req.file);
  console.log('[DEBUG] updateMarketingAsset req.body:', req.body);

  const { title, description, category, targetUniversities, targetBadges, status, expiryDate } = req.body;

  if (title) asset.title = title;
  if (description !== undefined) asset.description = description;
  if (category) asset.category = category;
  if (status) asset.status = status;
  if (expiryDate !== undefined) asset.expiryDate = expiryDate ? new Date(new Date(expiryDate).setUTCHours(23, 59, 59, 999)) : null;

  if (targetUniversities) {
    let parsedUnis = targetUniversities;
    if (typeof targetUniversities === 'string') {
      parsedUnis = targetUniversities.split(',').map(s => s.trim()).filter(Boolean);
    }
    asset.targetUniversities = parsedUnis;
  }
  if (targetBadges) {
    let parsedBadges = targetBadges;
    if (typeof targetBadges === 'string') {
      parsedBadges = targetBadges.split(',').map(s => s.trim()).filter(Boolean);
    }
    asset.targetBadges = parsedBadges;
  }

  if (req.file) {
    let newFileUrl = '';
    let newPublicId = '';
    let newFileSize = req.file.size;
    let newFileType = req.file.mimetype;

    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const uploadResult = await uploadToCloudinary(req.file.buffer, req.file.originalname);
      newFileUrl = uploadResult.secure_url || uploadResult.url;
      newPublicId = uploadResult.public_id;
      newFileSize = uploadResult.bytes || req.file.size;
    } else {
      const relativeUrl = '/uploads/' + req.file.filename;
      newFileUrl = req.protocol + '://' + req.get('host') + relativeUrl;
      newPublicId = req.file.filename;
    }

    asset.fileUrl = newFileUrl;
    asset.publicId = newPublicId;
    asset.fileSize = newFileSize;
    asset.fileType = newFileType;

    const nextVersionNum = (asset.versions.length ? Math.max(...asset.versions.map(v => v.versionNumber)) : 0) + 1;
    asset.versions.push({
      versionNumber: nextVersionNum,
      fileUrl: newFileUrl,
      publicId: newPublicId,
      fileSize: newFileSize,
      fileType: newFileType,
      uploadedBy: req.user.id,
      createdAt: new Date()
    });
  }

  await asset.save();
  sendSuccess(res, asset, 'Promotional asset updated successfully');
});

const deleteMarketingAsset = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  const cloudinary = require('../config/cloudinary');
  const { id } = req.params;

  const asset = await MarketingAsset.findById(id);
  if (!asset) {
    res.status(404);
    throw new Error('Marketing asset not found');
  }

  if (process.env.CLOUDINARY_CLOUD_NAME) {
    const destroyPromises = asset.versions
      .map(v => v.publicId)
      .filter(Boolean)
      .map(pid => cloudinary.uploader.destroy(pid));
    await Promise.allSettled(destroyPromises);
  }

  await asset.deleteOne();
  sendSuccess(res, null, 'Promotional asset deleted successfully');
});

const getMarketingAssetDownloadLogs = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  const { id } = req.params;

  const asset = await MarketingAsset.findById(id)
    .populate({
      path: 'downloads.user',
      select: 'name email phone ambassadorProfile.university'
    });

  if (!asset) {
    res.status(404);
    throw new Error('Marketing asset not found');
  }

  sendSuccess(res, asset.downloads, 'Download log retrieved successfully');
});

const getMarketingAssetsStats = asyncHandler(async (req, res) => {
  const MarketingAsset = require('../models/MarketingAsset');
  
  const allAssets = await MarketingAsset.find();
  const totalAssets = allAssets.length;
  const totalDownloads = allAssets.reduce((sum, a) => sum + (a.downloadsCount || 0), 0);

  const uniqueUsers = new Set();
  allAssets.forEach(a => {
    (a.downloads || []).forEach(d => {
      if (d.user) uniqueUsers.add(d.user.toString());
    });
  });
  const uniqueDownloads = uniqueUsers.size;

  let mostDownloaded = null;
  let leastDownloaded = null;

  if (totalAssets > 0) {
    const sortedDownloads = [...allAssets].sort((a, b) => b.downloadsCount - a.downloadsCount);
    mostDownloaded = {
      title: sortedDownloads[0].title,
      downloadsCount: sortedDownloads[0].downloadsCount
    };
    leastDownloaded = {
      title: sortedDownloads[sortedDownloads.length - 1].title,
      downloadsCount: sortedDownloads[sortedDownloads.length - 1].downloadsCount
    };
  }

  const categoryMap = {};
  allAssets.forEach(a => {
    if (!categoryMap[a.category]) {
      categoryMap[a.category] = { count: 0, downloads: 0 };
    }
    categoryMap[a.category].count += 1;
    categoryMap[a.category].downloads += (a.downloadsCount || 0);
  });

  sendSuccess(res, {
    totalAssets,
    totalDownloads,
    uniqueDownloads,
    mostDownloaded,
    leastDownloaded,
    categories: categoryMap
  }, 'Marketing asset statistics retrieved successfully');
});

// HELPER: Find matching ambassadors for a campaign
const getTargetRecipients = async (targetType, filters) => {
  const User = require('../models/User');
  const query = { isAmbassador: true, ambassadorStatus: 'approved' };

  if (targetType === 'university' && filters?.university) {
    query['ambassadorProfile.university'] = { $regex: new RegExp(`^${filters.university.trim()}$`, 'i') };
  } else if (targetType === 'badge' && filters?.badge) {
    query['ambassadorProfile.badge'] = filters.badge.toLowerCase();
  } else if (targetType === 'specific_ambassador' && filters?.userId) {
    query._id = filters.userId;
  }

  let recipients = await User.find(query);

  // Apply other dynamic segmentation filters
  if (targetType === 'top_10' || targetType === 'top_25') {
    recipients = recipients.sort((a, b) => (b.bookingsCount || 0) - (a.bookingsCount || 0));
    const limit = targetType === 'top_10' ? 10 : 25;
    recipients = recipients.slice(0, limit);
  } else if (targetType === 'active_month') {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const Booking = require('../models/Booking');
    const activeReferrals = await Booking.find({
      referredBy: { $in: recipients.map(r => r._id) },
      createdAt: { $gte: thirtyDaysAgo }
    }).select('referredBy');
    const activeUserIds = new Set(activeReferrals.map(b => b.referredBy.toString()));
    recipients = recipients.filter(r => activeUserIds.has(r._id.toString()));
  } else if (targetType === 'inactive_30') {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const Booking = require('../models/Booking');
    const activeReferrals = await Booking.find({
      referredBy: { $in: recipients.map(r => r._id) },
      createdAt: { $gte: thirtyDaysAgo }
    }).select('referredBy');
    const activeUserIds = new Set(activeReferrals.map(b => b.referredBy.toString()));
    recipients = recipients.filter(r => !activeUserIds.has(r._id.toString()));
  } else if (targetType === 'pending_payout') {
    const AmbassadorPayout = require('../models/AmbassadorPayout');
    const pendingPayouts = await AmbassadorPayout.find({
      user: { $in: recipients.map(r => r._id) },
      status: 'pending'
    }).select('user');
    const pendingUserIds = new Set(pendingPayouts.map(p => p.user.toString()));
    recipients = recipients.filter(r => pendingUserIds.has(r._id.toString()));
  } else if (targetType === 'recently_paid') {
    const AmbassadorPayout = require('../models/AmbassadorPayout');
    const fortnightAgo = new Date();
    fortnightAgo.setDate(fortnightAgo.getDate() - 14);
    const paidPayouts = await AmbassadorPayout.find({
      user: { $in: recipients.map(r => r._id) },
      status: 'paid',
      updatedAt: { $gte: fortnightAgo }
    }).select('user');
    const paidUserIds = new Set(paidPayouts.map(p => p.user.toString()));
    recipients = recipients.filter(r => paidUserIds.has(r._id.toString()));
  }

  return recipients;
};

// HELPER: Compile variables
const compileAmbassadorBody = (body, ambassador) => {
  const { FRONTEND_URL } = require('../config/appConfig');
  const university = ambassador.ambassadorProfile?.university || 'Relaxly University';
  const badge = ambassador.ambassadorProfile?.badge || 'Bronze';
  const referralCode = ambassador.ambassadorProfile?.referralCode || 'RELAXLY';
  const referralUrl = `${FRONTEND_URL}/register?ref=${referralCode}`;
  const walletBalance = `GHS ${(ambassador.ambassadorProfile?.wallet?.availableBalance || 0).toFixed(2)}`;
  const bookings = `${ambassador.bookingsCount || 0}`;

  return body.replace(/{{name}}/g, ambassador.name || 'Ambassador')
             .replace(/{{email}}/g, ambassador.email || '')
             .replace(/{{university}}/g, university)
             .replace(/{{badge}}/g, badge)
             .replace(/{{referralCode}}/g, referralCode)
             .replace(/{{referralUrl}}/g, referralUrl)
             .replace(/{{walletBalance}}/g, walletBalance)
             .replace(/{{bookings}}/g, bookings);
};

// @desc    Preview targeted ambassadors
// @route   POST /api/admin/ambassadors/campaigns/target-preview
// @access  Private/Admin
const getCampaignTargetPreview = asyncHandler(async (req, res) => {
  const { targetType, filters } = req.body;
  if (!targetType) {
    res.status(400);
    throw new Error('targetType is required.');
  }

  const sanitizedFilters = {};
  if (filters) {
    if (filters.userId && typeof filters.userId === 'string' && filters.userId.trim() !== '') {
      sanitizedFilters.userId = filters.userId.trim();
    }
    if (filters.university && typeof filters.university === 'string' && filters.university.trim() !== '') {
      sanitizedFilters.university = filters.university.trim();
    }
    if (filters.badge && typeof filters.badge === 'string' && filters.badge.trim() !== '') {
      sanitizedFilters.badge = filters.badge.trim();
    }
  }

  const recipients = await getTargetRecipients(targetType, sanitizedFilters);
  const previewList = recipients.map(r => ({
    _id: r._id,
    name: r.name,
    email: r.email,
    university: r.ambassadorProfile?.university || 'N/A',
    badge: r.ambassadorProfile?.badge || 'Bronze',
    bookingsCount: r.bookingsCount || 0
  }));

  sendSuccess(res, previewList, 'Target preview generated successfully');
});

// @desc    Create/Schedule or dispatch campaign
// @route   POST /api/admin/ambassadors/campaigns
// @access  Private/Admin
const createAmbassadorCampaign = asyncHandler(async (req, res) => {
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');
  const AmbassadorCampaignRecipient = require('../models/AmbassadorCampaignRecipient');
  const emailService = require('../services/emailService');
  const { createNotification } = require('../services/notificationService');
  const socketManager = require('../utils/socketManager');

  const { subject, previewText, body, ctaText, ctaLink, targetType, filters, assetIds, status, scheduledFor } = req.body;

  if (!subject || !body || !targetType) {
    res.status(400);
    throw new Error('Subject, body, and targetType are required.');
  }

  const sanitizedFilters = {};
  if (filters) {
    if (filters.userId && typeof filters.userId === 'string' && filters.userId.trim() !== '') {
      sanitizedFilters.userId = filters.userId.trim();
    }
    if (filters.university && typeof filters.university === 'string' && filters.university.trim() !== '') {
      sanitizedFilters.university = filters.university.trim();
    }
    if (filters.badge && typeof filters.badge === 'string' && filters.badge.trim() !== '') {
      sanitizedFilters.badge = filters.badge.trim();
    }
  }

  const campaign = await AmbassadorCampaign.create({
    subject,
    previewText,
    body,
    ctaText,
    ctaLink,
    targetType,
    filters: sanitizedFilters,
    assetIds: assetIds || [],
    status: status || 'draft',
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    createdBy: req.user.id
  });

  const recipients = await getTargetRecipients(targetType, sanitizedFilters);
  campaign.recipientCount = recipients.length;
  await campaign.save();

  if (status === 'sent') {
    campaign.sentAt = new Date();
    await campaign.save();

    let sent = 0;
    let failed = 0;

    for (const rec of recipients) {
      try {
        // 1. Create Recipient Log
        const log = await AmbassadorCampaignRecipient.create({
          campaignId: campaign._id,
          user: rec._id,
          emailAddress: rec.email,
          status: 'pending'
        });

        // 2. Email Delivery via Resend
        const finalHtml = compileAmbassadorBody(body, rec);
        let finalCta = '';
        if (ctaText && ctaLink) {
          finalCta = `<div style="margin-top: 25px; text-align: center;"><a href="${ctaLink}" style="background-color: #2563EB; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">${ctaText}</a></div>`;
        }

        const emailContent = `
          <div>
            <p>${finalHtml.replace(/\n/g, '<br />')}</p>
            ${finalCta}
          </div>
        `;

        await emailService.sendEmail({
          email: rec.email,
          subject,
          html: emailContent,
          campaignId: campaign._id,
          userId: rec._id
        });

        log.status = 'sent';
        await log.save();
        sent += 1;

        // 3. In-App Notification
        await createNotification({
          user: rec._id,
          title: subject,
          message: previewText || 'New campaign creative has been shared.',
          type: 'system'
        });

        // 4. WebSocket Notification
        socketManager.notifyUser(rec._id, 'notification_received', {
          title: subject,
          message: previewText || 'New campaign creative has been shared.'
        });

      } catch (err) {
        failed += 1;
        await AmbassadorCampaignRecipient.create({
          campaignId: campaign._id,
          user: rec._id,
          emailAddress: rec.email,
          status: 'failed',
          error: err.message
        });
      }
    }

    campaign.deliveryStats = {
      sent,
      delivered: sent,
      failed,
      opened: 0,
      clicked: 0
    };
    await campaign.save();
  }

  const { logAdminAction } = require('../utils/auditLogger');
  await logAdminAction({
    req,
    actionType: campaign.status === 'sent' ? 'CAMPAIGN_SEND' : 'CAMPAIGN_CREATE',
    targetType: 'User',
    targetId: campaign._id,
    severity: 'medium',
    metadata: { subject: campaign.subject, targetType: campaign.targetType }
  });

  const logger = require('../utils/logger');
  logger.info(`[CAMPAIGN_CREATED] Campaign: ${campaign._id}, subject: "${campaign.subject}", status: "${campaign.status}"`);

  if (campaign.status === 'sent') {
    logger.info(`[CAMPAIGN_SENT] Campaign: ${campaign._id} dispatched to ${campaign.recipientCount || 0} recipients.`);
  }

  sendSuccess(res, campaign, 'Campaign saved successfully', 201);
});

// @desc    List all ambassador campaigns
// @route   GET /api/admin/ambassadors/campaigns
// @access  Private/Admin
const getAmbassadorCampaigns = asyncHandler(async (req, res) => {
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');
  
  // Trigger scheduled dispatches check on list load to evaluate scheduled ones
  const now = new Date();
  const scheduled = await AmbassadorCampaign.find({ status: 'scheduled', scheduledFor: { $lte: now } });
  
  if (scheduled.length > 0) {
    const AmbassadorCampaignRecipient = require('../models/AmbassadorCampaignRecipient');
    const emailService = require('../services/emailService');
    const { createNotification } = require('../services/notificationService');
    const socketManager = require('../utils/socketManager');

    for (const camp of scheduled) {
      camp.status = 'sent';
      camp.sentAt = new Date();
      await camp.save();

      const recipients = await getTargetRecipients(camp.targetType, camp.filters || {});
      let sent = 0;
      let failed = 0;

      for (const rec of recipients) {
        try {
          const log = await AmbassadorCampaignRecipient.create({
            campaignId: camp._id,
            user: rec._id,
            emailAddress: rec.email,
            status: 'pending'
          });

          const finalHtml = compileAmbassadorBody(camp.body, rec);
          let finalCta = '';
          if (camp.ctaText && camp.ctaLink) {
            finalCta = `<div style="margin-top: 25px; text-align: center;"><a href="${camp.ctaLink}" style="background-color: #2563EB; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">${camp.ctaText}</a></div>`;
          }

          const emailContent = `
            <div>
              <p>${finalHtml.replace(/\n/g, '<br />')}</p>
              ${finalCta}
            </div>
          `;

          await emailService.sendEmail({
            email: rec.email,
            subject: camp.subject,
            html: emailContent,
            campaignId: camp._id,
            userId: rec._id
          });

          log.status = 'sent';
          await log.save();
          sent += 1;

          await createNotification({
            user: rec._id,
            title: camp.subject,
            message: camp.previewText || 'New campaign creative shared.',
            type: 'system'
          });

          socketManager.notifyUser(rec._id, 'notification_received', {
            title: camp.subject,
            message: camp.previewText || 'New campaign creative shared.'
          });
        } catch (err) {
          failed += 1;
          await AmbassadorCampaignRecipient.create({
            campaignId: camp._id,
            user: rec._id,
            emailAddress: rec.email,
            status: 'failed',
            error: err.message
          });
        }
      }

      camp.deliveryStats = { sent, delivered: sent, failed, opened: 0, clicked: 0 };
      await camp.save();
    }
  }

  const campaigns = await AmbassadorCampaign.find()
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });

  sendSuccess(res, campaigns, 'Ambassador campaigns loaded successfully');
});

// @desc    Get detailed campaign report
// @route   GET /api/admin/ambassadors/campaigns/:id
// @access  Private/Admin
const getAmbassadorCampaignDetail = asyncHandler(async (req, res) => {
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');
  const AmbassadorCampaignRecipient = require('../models/AmbassadorCampaignRecipient');
  const { id } = req.params;

  const campaign = await AmbassadorCampaign.findById(id).populate('createdBy', 'name');
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found.');
  }

  const recipients = await AmbassadorCampaignRecipient.find({ campaignId: id })
    .populate('user', 'name email ambassadorProfile.university ambassadorProfile.badge')
    .sort({ createdAt: -1 });

  sendSuccess(res, { campaign, recipients }, 'Campaign detailed report loaded');
});

// @desc    Send test campaign email
// @route   POST /api/admin/ambassadors/campaigns/:id/test
// @access  Private/Admin
const sendTestCampaignEmail = asyncHandler(async (req, res) => {
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');
  const emailService = require('../services/emailService');
  const { id } = req.params;

  const campaign = await AmbassadorCampaign.findById(id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found.');
  }

  const placeholderAmbassador = {
    name: req.user.name || 'Test Administrator',
    email: req.user.email,
    ambassadorProfile: {
      university: 'University of Ghana (Test)',
      badge: 'Gold',
      referralCode: 'TEST99',
      wallet: { availableBalance: 120.50 }
    },
    bookingsCount: 15
  };

  const finalHtml = compileAmbassadorBody(campaign.body, placeholderAmbassador);
  let finalCta = '';
  if (campaign.ctaText && campaign.ctaLink) {
    finalCta = `<div style="margin-top: 25px; text-align: center;"><a href="${campaign.ctaLink}" style="background-color: #2563EB; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">${campaign.ctaText}</a></div>`;
  }

  const emailContent = `
    <div style="border: 2px dashed #2563EB; padding: 15px; margin-bottom: 20px; border-radius: 8px; background-color: #EFF6FF;">
      <strong style="color: #2563EB; font-size: 12px;">[TEST EMAIL BROADCAST MODE]</strong>
      <p style="margin: 5px 0 0 0; font-size: 11px; color: #1E3A8A;">This is a test visualization sent only to your address: ${req.user.email}</p>
    </div>
    <div>
      <p>${finalHtml.replace(/\n/g, '<br />')}</p>
      ${finalCta}
    </div>
  `;

  await emailService.sendEmail({
    email: req.user.email,
    subject: `[TEST] ${campaign.subject}`,
    html: emailContent,
    userId: req.user._id
  });

  sendSuccess(res, null, `Test email successfully sent to ${req.user.email}`);
});

// @desc    Delete/Cancel campaign
// @route   DELETE /api/admin/ambassadors/campaigns/:id
// @access  Private/Admin
const deleteAmbassadorCampaign = asyncHandler(async (req, res) => {
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');
  const AmbassadorCampaignRecipient = require('../models/AmbassadorCampaignRecipient');
  const { id } = req.params;

  const campaign = await AmbassadorCampaign.findById(id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found.');
  }

  await AmbassadorCampaignRecipient.deleteMany({ campaignId: id });
  await campaign.deleteOne();

  sendSuccess(res, null, 'Campaign successfully deleted');
});

// @desc    Get marketing campaign and referral analytics overview
// @route   GET /api/admin/ambassadors/analytics-overview
// @access  Private/Admin
const getAdminReferralAnalytics = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const AmbassadorBooking = require('../models/AmbassadorBooking');
  const AmbassadorReferral = require('../models/AmbassadorReferral');
  const ReferralClick = require('../models/ReferralClick');
  const AmbassadorCampaign = require('../models/AmbassadorCampaign');

  const [topAmbassadors, universityStats, channelStats, campaignConversions] = await Promise.all([
    // 1. Top Ambassadors (highest score or bookings)
    User.find({ isAmbassador: true, ambassadorStatus: 'approved' })
      .select('name email avatar ambassadorProfile.university ambassadorProfile.badge')
      .limit(10),

    // 2. University stats (total ambassadors, total bookings, total conversions)
    User.aggregate([
      { $match: { isAmbassador: true, ambassadorStatus: 'approved' } },
      {
        $group: {
          _id: '$ambassadorProfile.university',
          ambassadorCount: { $sum: 1 }
        }
      }
    ]),

    // 3. Channel breakdown (total clicks per source)
    ReferralClick.aggregate([
      { $group: { _id: '$source', clicksCount: { $sum: 1 } } }
    ]),

    // 4. Campaign conversions attribution
    ReferralClick.aggregate([
      { $match: { campaignId: { $ne: null } } },
      {
        $group: {
          _id: '$campaignId',
          clicksCount: { $sum: 1 }
        }
      }
    ])
  ]);

  // Compute stats for top ambassadors
  const top10 = await Promise.all(topAmbassadors.map(async (amb) => {
    const referralCode = amb.ambassadorProfile?.referralCode || '';
    const [bookingsCount, referralsCount, clicksCount] = await Promise.all([
      AmbassadorBooking.countDocuments({ ambassador: amb._id, status: { $in: ['pending', 'approved', 'paid'] } }),
      AmbassadorReferral.countDocuments({ ambassador: amb._id }),
      referralCode ? ReferralClick.countDocuments({ referralCode, clickType: 'click' }) : Promise.resolve(0)
    ]);
    const conversionRate = clicksCount > 0 ? parseFloat(((referralsCount / clicksCount) * 100).toFixed(1)) : 0;
    return {
      _id: amb._id,
      name: amb.name,
      university: amb.ambassadorProfile?.university || 'Ghana Campus',
      bookingsCount,
      referralsCount,
      clicksCount,
      conversionRate
    };
  }));

  // Sort by bookingsCount desc
  top10.sort((a, b) => b.bookingsCount - a.bookingsCount);

  // Compute university stats
  const populatedUniStats = await Promise.all(universityStats.map(async (uni) => {
    const uniName = uni._id || 'Other';
    const [bookingsCount, referralsCount] = await Promise.all([
      AmbassadorBooking.countDocuments({ university: uniName, status: { $in: ['pending', 'approved', 'paid'] } }),
      User.countDocuments({ role: 'student', 'ambassadorProfile.university': uniName })
    ]);
    return {
      university: uniName,
      ambassadorCount: uni.ambassadorCount,
      bookingsCount,
      referralsCount
    };
  }));

  // Populate campaign conversions with title
  const campaignsList = await Promise.all(campaignConversions.map(async (cc) => {
    const campaign = await AmbassadorCampaign.findById(cc._id);
    
    // Find how many clicks converted to registration started
    const registrationStarts = await ReferralClick.countDocuments({ campaignId: cc._id, clickType: 'registration_started' });
    const convertedRegistrations = await User.countDocuments({
      role: 'student',
      _id: { $in: (await ReferralClick.find({ campaignId: cc._id }).distinct('referredStudent')) }
    });

    return {
      title: campaign ? campaign.subject : 'Asset Campaign Push',
      clicksCount: cc.clicksCount,
      registrationStarts,
      convertedRegistrations
    };
  }));

  sendSuccess(res, {
    top10,
    universityStats: populatedUniStats,
    channelStats,
    campaignsList
  }, 'Admin referral analytics overview loaded');
});

// @desc    Impersonate ambassador and retrieve their dashboard analytics
// @route   GET /api/admin/ambassadors/:id/dashboard
// @access  Private/Admin
const impersonateAmbassadorDashboard = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { getAmbassadorDashboard } = require('../services/ambassadorService');

  const User = require('../models/User');
  const ambassador = await User.findOne({ _id: id, isAmbassador: true });

  if (!ambassador) {
    res.status(404);
    throw new Error('Ambassador not found.');
  }

  const dashboardData = await getAmbassadorDashboard(id);
  sendSuccess(res, dashboardData, 'Ambassador portal impersonation data retrieved successfully');
});

module.exports = {
  impersonateAmbassadorDashboard,
  getAdminReferralAnalytics,
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
  getCacheStats,
  getNotificationMetrics,
  getCustomUniversities,
  getOwnerTimeline,
  updateSupportSettings,
  getAllAmbassadors,
  approveAmbassador,
  rejectAmbassador,
  suspendAmbassador,
  getAllAmbassadorPayouts,
  reviewAmbassadorPayout,
  getAmbassadorCommissionSettings,
  updateAmbassadorCommissionSettings,
  getAmbassadorFinanceOverview,
  getAllReferrals,
  getAmbassadorTimeline,
  syncLeaderboard,
  resetSeason,
  uploadMarketingAsset,
  getMarketingAssetsAdmin,
  updateMarketingAsset,
  deleteMarketingAsset,
  getMarketingAssetDownloadLogs,
  getMarketingAssetsStats,
  getCampaignTargetPreview,
  createAmbassadorCampaign,
  getAmbassadorCampaigns,
  getAmbassadorCampaignDetail,
  sendTestCampaignEmail,
  deleteAmbassadorCampaign
};
