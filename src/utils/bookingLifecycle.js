const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const User = require('../models/User');

const ACTIVE_BOOKING_STATUSES = ['pending', 'approved'];
const ACTIVE_PAYMENT_STATUSES = ['pending', 'paid'];
const REQUIRED_FINANCIAL_FIELDS = [
  'roomPrice',
  'bookingFee',
  'commissionRate',
  'adminCommission',
  'paystackFee',
  'platformGrossRevenue',
  'platformNetProfit',
  'platformNetRevenue',
  'taxReserve',
  'platformFinalRetainedProfit',
  'platformLoss',
  'ownerAmount',
  'totalPaid',
  'amount',
  'commissionPercent',
  'serviceFeePercent',
  'commissionAmount',
  'serviceFeeAmount',
];

const logLifecycleEvent = (event, data = {}) => {
  console.log(
    JSON.stringify({
      scope: 'booking_lifecycle',
      event,
      at: new Date().toISOString(),
      ...data,
    })
  );
};

const syncHostelAvailability = async (hostelId) => {
  const availableRooms = await Room.countDocuments({
    hostel: hostelId,
    availableBeds: { $gt: 0 },
    roomStatus: 'available',
  });

  await Hostel.findByIdAndUpdate(hostelId, { availableRooms });
  return availableRooms;
};

const restoreRoomBed = async (bookingId, reason = 'restored') => {
  const booking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      bedRestored: false,
    },
    {
      $set: {
        bedRestored: true,
      },
    },
    { new: true }
  );

  if (!booking) {
    logLifecycleEvent('bed_restoration_skipped', {
      bookingId: bookingId?.toString(),
      reason,
    });
    return null;
  }

  const student = await User.findById(booking.student).select('gender');

  if (!student?.gender) {
    logLifecycleEvent('bed_restoration_skipped_missing_gender', {
      bookingId: booking._id.toString(),
      studentId: booking.student.toString(),
      reason,
    });
    return booking;
  }

  const updateField =
    student.gender === 'Male' ? 'maleAvailableBeds' : 'femaleAvailableBeds';

  const updatedRoom = await Room.findOneAndUpdate(
    {
      _id: booking.room,
      [updateField]: { $lt: Number.MAX_SAFE_INTEGER },
      availableBeds: { $lt: Number.MAX_SAFE_INTEGER },
    },
    {
      $inc: {
        [updateField]: 1,
        availableBeds: 1,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (updatedRoom?.availableBeds > 0 && updatedRoom.roomStatus === 'unavailable') {
    updatedRoom.roomStatus = 'available';
    await updatedRoom.save();
  }

  await syncHostelAvailability(booking.hostel);

  logLifecycleEvent('bed_restored', {
    bookingId: booking._id.toString(),
    roomId: booking.room.toString(),
    hostelId: booking.hostel.toString(),
    studentId: booking.student.toString(),
    reason,
  });

  return booking;
};

const expireBookingReservation = async (bookingId, reason = 'reservation_expired') => {
  const booking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      bookingStatus: 'pending',
      paymentStatus: 'pending',
    },
    {
      $set: {
        bookingStatus: 'expired',
        paymentStatus: 'expired',
      },
    },
    { new: true }
  );

  if (!booking) {
    return null;
  }

  logLifecycleEvent('reservation_expired', {
    bookingId: booking._id.toString(),
    roomId: booking.room.toString(),
    hostelId: booking.hostel.toString(),
    studentId: booking.student.toString(),
    reason,
  });

  await restoreRoomBed(booking._id, reason);
  return booking;
};

const cleanupExpiredReservations = async (filter = {}) => {
  const now = new Date();
  const expiredBookings = await Booking.find({
    ...filter,
    bookingStatus: 'pending',
    paymentStatus: 'pending',
    expiresAt: { $lte: now },
  }).select('_id room hostel student expiresAt');

  for (const booking of expiredBookings) {
    await expireBookingReservation(booking._id);
  }

  if (expiredBookings.length > 0) {
    logLifecycleEvent('expired_reservations_cleaned', {
      count: expiredBookings.length,
      filter,
    });
  }

  return expiredBookings.length;
};

const findActiveStudentRoomBooking = async (studentId, roomId) =>
  Booking.findOne({
    student: studentId,
    room: roomId,
    bookingStatus: { $in: ACTIVE_BOOKING_STATUSES },
    paymentStatus: { $in: ACTIVE_PAYMENT_STATUSES },
  }).sort({ createdAt: -1 });

const validateFinancialSnapshot = (booking) => {
  // Add defaults for missing new percentage fields for legacy bookings
  if (booking.commissionPercent === undefined) booking.commissionPercent = booking.commissionRate || 0;
  if (booking.serviceFeePercent === undefined) booking.serviceFeePercent = 0;
  if (booking.commissionAmount === undefined) booking.commissionAmount = booking.adminCommission || 0;
  if (booking.serviceFeeAmount === undefined) booking.serviceFeeAmount = booking.bookingFee || 0;
  if (booking.platformNetRevenue === undefined) booking.platformNetRevenue = booking.platformNetProfit || 0;

  const missingFields = REQUIRED_FINANCIAL_FIELDS.filter((field) => {
    const value = booking[field];
    return value === undefined || value === null || Number.isNaN(Number(value));
  });

  if (missingFields.length > 0) {
    const error = new Error(
      `Booking is missing required financial snapshot fields: ${missingFields.join(', ')}`
    );
    error.statusCode = 409;
    error.missingFields = missingFields;
    throw error;
  }

  if (Number(booking.totalPaid) <= 0 || Number(booking.amount) <= 0) {
    const error = new Error('Booking financial snapshot contains an invalid amount');
    error.statusCode = 409;
    throw error;
  }
};

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  ACTIVE_PAYMENT_STATUSES,
  cleanupExpiredReservations,
  expireBookingReservation,
  findActiveStudentRoomBooking,
  logLifecycleEvent,
  restoreRoomBed,
  syncHostelAvailability,
  validateFinancialSnapshot,
};
