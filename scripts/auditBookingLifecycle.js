const dotenv = require('dotenv');
const mongoose = require('mongoose');

const Booking = require('../src/models/Booking');
const Room = require('../src/models/Room');
const connectDB = require('../src/config/db');
const {
  cleanupExpiredReservations,
  syncHostelAvailability,
} = require('../src/utils/bookingLifecycle');

dotenv.config();

const REQUIRED_FINANCIAL_FIELDS = [
  'roomPrice',
  'bookingFee',
  'commissionRate',
  'adminCommission',
  'paystackFee',
  'platformGrossRevenue',
  'platformNetProfit',
  'taxReserve',
  'platformFinalRetainedProfit',
  'platformLoss',
  'ownerAmount',
  'totalPaid',
  'amount',
];

const ids = (docs) => docs.map((doc) => doc._id.toString());

const printSection = (title, items) => {
  console.log(`\n=== ${title} (${items.length}) ===`);
  if (items.length === 0) {
    return;
  }
  console.log(JSON.stringify(items, null, 2));
};

const audit = async () => {
  await connectDB();

  const shouldFixExpired = process.argv.includes('--fix-expired');
  const shouldSyncHostels = process.argv.includes('--sync-hostels');

  if (shouldFixExpired) {
    const fixedCount = await cleanupExpiredReservations();
    console.log(`Expired pending reservations fixed: ${fixedCount}`);
  }

  const now = new Date();

  const paidButPending = await Booking.find({
    paymentStatus: 'paid',
    bookingStatus: 'pending',
  }).select('_id student room hostel paymentReference');

  const paidButNotApprovedOrCompleted = await Booking.find({
    paymentStatus: 'paid',
    bookingStatus: { $nin: ['approved', 'completed'] },
  }).select('_id student room hostel bookingStatus paymentReference');

  const approvedButUnpaid = await Booking.find({
    bookingStatus: { $in: ['approved', 'completed'] },
    paymentStatus: { $ne: 'paid' },
  }).select('_id student room hostel bookingStatus paymentStatus paymentReference');

  const missingFinancialSnapshot = await Booking.find({
    $or: REQUIRED_FINANCIAL_FIELDS.map((field) => ({
      [field]: { $in: [null, undefined] },
    })),
  }).select(`_id student room hostel bookingStatus paymentStatus ${REQUIRED_FINANCIAL_FIELDS.join(' ')}`);

  const invalidTotalPaid = await Booking.find({
    $or: [
      { totalPaid: { $exists: false } },
      { totalPaid: null },
      { totalPaid: { $lte: 0 } },
      { amount: { $exists: false } },
      { amount: null },
      { amount: { $lte: 0 } },
    ],
  }).select('_id student room hostel amount totalPaid bookingStatus paymentStatus');

  const expiredPending = await Booking.find({
    bookingStatus: 'pending',
    paymentStatus: 'pending',
    expiresAt: { $lte: now },
  }).select('_id student room hostel expiresAt bedRestored paymentReference');

  const staleReservations = await Booking.find({
    bookingStatus: { $in: ['cancelled', 'rejected', 'expired'] },
    bedRestored: false,
  }).select('_id student room hostel bookingStatus paymentStatus expiresAt');

  const duplicatePaymentReferences = await Booking.aggregate([
    {
      $match: {
        paymentReference: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: '$paymentReference',
        count: { $sum: 1 },
        bookings: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const duplicateActiveBookings = await Booking.aggregate([
    {
      $match: {
        bookingStatus: { $in: ['pending', 'approved'] },
        paymentStatus: { $in: ['pending', 'paid'] },
      },
    },
    {
      $group: {
        _id: {
          student: '$student',
          room: '$room',
        },
        count: { $sum: 1 },
        bookings: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const rooms = await Room.find().select(
    '_id hostel capacity availableBeds maleAvailableBeds femaleAvailableBeds roomStatus'
  );

  const inconsistentRooms = rooms
    .filter((room) => {
      const maleBeds = Number(room.maleAvailableBeds || 0);
      const femaleBeds = Number(room.femaleAvailableBeds || 0);
      const availableBeds = Number(room.availableBeds || 0);
      const calculatedAvailableBeds = maleBeds + femaleBeds;

      return (
        availableBeds !== calculatedAvailableBeds ||
        availableBeds < 0 ||
        maleBeds < 0 ||
        femaleBeds < 0 ||
        availableBeds > Number(room.capacity || 0) ||
        (availableBeds === 0 && room.roomStatus === 'available') ||
        (availableBeds > 0 && room.roomStatus === 'unavailable')
      );
    })
    .map((room) => ({
      room: room._id.toString(),
      hostel: room.hostel.toString(),
      capacity: room.capacity,
      availableBeds: room.availableBeds,
      maleAvailableBeds: room.maleAvailableBeds,
      femaleAvailableBeds: room.femaleAvailableBeds,
      roomStatus: room.roomStatus,
      calculatedAvailableBeds:
        Number(room.maleAvailableBeds || 0) + Number(room.femaleAvailableBeds || 0),
    }));

  if (shouldSyncHostels) {
    const hostelIds = [...new Set(rooms.map((room) => room.hostel.toString()))];
    for (const hostelId of hostelIds) {
      await syncHostelAvailability(hostelId);
    }
    console.log(`Hostel availability counters synced: ${hostelIds.length}`);
  }

  printSection('paid paymentStatus but pending bookingStatus', ids(paidButPending));
  printSection('paid bookings not approved/completed', ids(paidButNotApprovedOrCompleted));
  printSection('approved/completed bookings that are not paid', ids(approvedButUnpaid));
  printSection('bookings missing financial snapshot fields', missingFinancialSnapshot);
  printSection('bookings with invalid amount/totalPaid', ids(invalidTotalPaid));
  printSection('expired pending reservations', ids(expiredPending));
  printSection('cancelled/rejected/expired bookings with un-restored beds', ids(staleReservations));
  printSection('duplicate payment references', duplicatePaymentReferences);
  printSection('duplicate active student-room bookings', duplicateActiveBookings);
  printSection('rooms with inconsistent availability fields', inconsistentRooms);

  await mongoose.disconnect();
};

audit().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
