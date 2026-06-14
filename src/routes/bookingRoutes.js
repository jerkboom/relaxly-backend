const express = require('express');
const router = express.Router();

const {
  createBooking,
  getBookings,
  getMyBookings,
  getBookingById,
  getOwnerBookings,
  cancelBooking,
  updateBookingStatus,
  checkInStudent,
  updateRoomAssignment,
  checkOutStudent,
} = require('../controllers/bookingController');

const {
  protect,
  authorizeRoles,
} = require('../middleware/authMiddleware');

const {
  isEmailVerified,
} = require('../middleware/verificationMiddleware');

const { validateObjectIds } = require('../middleware/validationMiddleware');

const checkMaintenanceMode = require('../middleware/maintenanceMiddleware');

/* ========================================
   CREATE BOOKING
======================================== */
router.post(
  '/',
  protect,
  checkMaintenanceMode,
  authorizeRoles('student'),
  isEmailVerified,
  validateObjectIds(['room', 'hostel'], 'body'),
  createBooking
);

/* ========================================
   GET STUDENT BOOKINGS
======================================== */
router.get(
  '/my-bookings',
  protect,
  authorizeRoles('student'),
  getMyBookings
);

/* ========================================
   GET OWNER BOOKINGS
======================================== */
router.get(
  '/owner',
  protect,
  authorizeRoles('owner'),
  getOwnerBookings
);

/* ========================================
   GET SINGLE BOOKING / RECEIPT
======================================== */
router.get(
  '/:id',
  protect,
  validateObjectIds(['id']),
  getBookingById
);

/* ========================================
   GET ALL BOOKINGS
======================================== */
router.get(
  '/',
  protect,
  getBookings
);

/* ========================================
   UPDATE BOOKING STATUS
======================================== */
router.put(
  '/:id/status',
  protect,
  authorizeRoles('owner', 'admin'),
  validateObjectIds(['id']),
  updateBookingStatus
);

/* ========================================
   CANCEL BOOKING
======================================== */
router.put(
  '/:id/cancel',
  protect,
  checkMaintenanceMode,
  authorizeRoles('student'),
  validateObjectIds(['id']),
  cancelBooking
);

router.patch('/:id/check-in', protect, authorizeRoles('owner', 'admin'), validateObjectIds(['id']), checkInStudent);
router.patch('/:id/room-assignment', protect, authorizeRoles('owner', 'admin'), validateObjectIds(['id']), updateRoomAssignment);
router.patch('/:id/check-out', protect, authorizeRoles('owner', 'admin'), validateObjectIds(['id']), checkOutStudent);

module.exports = router;

