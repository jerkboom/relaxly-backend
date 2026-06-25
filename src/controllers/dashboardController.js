const asyncHandler =
  require(
    'express-async-handler'
  );

const Booking =
  require('../models/Booking');

const Hostel =
  require('../models/Hostel');

const Room =
  require('../models/Room');

const Notification =
  require('../models/Notification');

const PayoutQueue =
  require('../models/PayoutQueue');

const cache = require('../utils/cache');

const getStudentDashboard =
  asyncHandler(
    async (req, res) => {
      const studentId =
        req.user.id;

      const cacheKey = `student_dashboard_${studentId}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.status(200).json(cached);
      }

      const bookings =
        await Booking.find({
          student: studentId,
        })
          .select('bookingStatus paymentStatus amount createdAt hostel room')
          .populate(
            'hostel',
            'name location'
          )
          .populate(
            'room',
            'roomType price'
          )
          .sort({
            createdAt: -1,
          })
          .lean();

      // STATS
      const totalBookings =
        bookings.length;

      const activeBookings =
        bookings.filter(
          (booking) =>
            booking.bookingStatus ===
            'approved'
        ).length;

      const pendingBookings =
        bookings.filter(
          (booking) =>
            booking.bookingStatus ===
            'pending'
        ).length;

      const totalPayments =
        bookings
          .filter(
            (booking) =>
              booking.paymentStatus ===
              'paid'
          )
          .reduce(
            (
              total,
              booking
            ) =>
              total +
              booking.amount,
            0
          );

      const responseData = {
        stats: {
          totalBookings,
          activeBookings,
          pendingBookings,
          totalPayments,
        },

        recentBookings:
          bookings.slice(0, 5),
      };

      // CACHE DATA
      cache.set(cacheKey, responseData, 60); // 60 seconds

      res.status(200).json(responseData);
    }
  );

const getOwnerDashboard =
  asyncHandler(
    async (req, res) => {
      console.log('--- Owner Dashboard Request ---');
      console.log('User:', { id: req.user._id, role: req.user.role, email: req.user.email });

      const ownerId = req.user.id;

      const cacheKey = `owner_dashboard_${ownerId}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.status(200).json(cached);
      }

      // 1. GET ALL HOSTELS OWNED BY THIS OWNER
      const hostels =
        await Hostel.find({
          owner: ownerId,
        })
          .select('_id')
          .lean();

      const hostelIds = hostels.map(
        (h) => h._id
      );

      const totalHostels =
        hostels.length;

      // 2. GET ALL ROOMS IN THESE HOSTELS
      const rooms = await Room.find({
        hostel: { $in: hostelIds },
      })
        .select('capacity availableBeds')
        .lean();

      const totalRooms = rooms.length;

      // 3. CALCULATE OCCUPANCY
      const totalCapacity =
        rooms.reduce(
          (sum, room) =>
            sum + room.capacity,
          0
        );

      const availableBeds =
        rooms.reduce(
          (sum, room) =>
            sum + room.availableBeds,
          0
        );

      const occupiedBeds =
        totalCapacity -
        availableBeds;

      const occupancyRate =
        totalCapacity > 0
          ? Math.round(
              (occupiedBeds /
                totalCapacity) *
                100
            )
          : 0;

      // 4. BOOKING STATS & REVENUE (Database Aggregation)
      const bookingStats = await Booking.aggregate([
        { $match: { hostel: { $in: hostelIds } } },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            earnings: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$paymentStatus', 'paid'] },
                      { $eq: ['$bookingStatus', 'approved'] }
                    ]
                  },
                  { $ifNull: ['$ownerAmount', 0] },
                  0
                ]
              }
            }
          }
        }
      ]);

      const totalBookings = bookingStats[0]?.totalBookings || 0;
      const earnings = bookingStats[0]?.earnings || 0;

      // 5. NOTIFICATIONS
      const notificationsCount =
        await Notification.countDocuments({
          user: ownerId,
          read: false,
        });

      // 6. RECENT BOOKINGS
      const recentBookings =
        await Booking.find({
          hostel: { $in: hostelIds },
        })
          .select('student room hostel createdAt bookingStatus paymentStatus amount bookingCode')
          .populate(
            'student',
            'name email'
          )
          .populate(
            'room',
            'roomType price'
          )
          .populate(
            'hostel',
            'name'
          )
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();

      // 7. PAYOUT STATS (Database Aggregation)
      const payoutStats = await PayoutQueue.aggregate([
        { $match: { owner: ownerId } },
        {
          $group: {
            _id: null,
            pendingPayouts: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['pending', 'approved', 'processing', 'otp_pending']] },
                  { $ifNull: ['$finalTransferAmount', 0] },
                  0
                ]
              }
            },
            paidPayouts: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'paid'] },
                  { $ifNull: ['$finalTransferAmount', 0] },
                  0
                ]
              }
            }
          }
        }
      ]);

      const pendingPayouts = payoutStats[0]?.pendingPayouts || 0;
      const paidPayouts = payoutStats[0]?.paidPayouts || 0;

      // 8. LIVE BALANCE CALCULATION
      // Total earnings from all paid+approved bookings MINUS what has already been sent to bank (paidPayouts)
      const liveBalance = Math.max(0, earnings - paidPayouts);

      const responseData = {
        totalHostels,
        totalRooms,
        totalBookings,
        occupancyRate,
        recentBookings,
        earnings,
        totalRevenue: earnings, // Total lifetime earnings
        liveBalance,            // Current owed amount
        notificationsCount,
        pendingPayouts,
        paidPayouts,
      };

      // CACHE DATA
      cache.set(cacheKey, responseData, 60); // 60 seconds

      // Return requested fields + backward compatibility for frontend
      res.status(200).json(responseData);
    }
  );

module.exports = {
  getStudentDashboard,
  getOwnerDashboard,
};

