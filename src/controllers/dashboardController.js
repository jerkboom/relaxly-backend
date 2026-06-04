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
          });

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
        });

      const hostelIds = hostels.map(
        (h) => h._id
      );

      const totalHostels =
        hostels.length;

      // 2. GET ALL ROOMS IN THESE HOSTELS
      const rooms = await Room.find({
        hostel: { $in: hostelIds },
      });

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

      // 4. BOOKING STATS & REVENUE
      const allBookings = await Booking.find({
        hostel: { $in: hostelIds },
      });

      const totalBookings = allBookings.length;

      // Earnings: only paid bookings that are approved
      const earnings = allBookings
        .filter(
          (booking) =>
            booking.paymentStatus === 'paid' &&
            booking.bookingStatus === 'approved'
        )
        .reduce((sum, booking) => sum + (booking.ownerAmount || 0), 0);

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
          .limit(5);

            // 7. PAYOUT STATS
      const payouts = await PayoutQueue.find({ owner: ownerId });
      const pendingPayouts = payouts.filter(p => ['pending', 'approved', 'processing', 'otp_pending'].includes(p.status)).reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);
      const paidPayouts = payouts.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);

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

