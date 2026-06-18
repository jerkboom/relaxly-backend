const express = require('express');
const router = express.Router();

const {
  createHostel,
  getHostels,
  getOwnerHostels,
  getSingleHostel,
  getHostelRooms,
  getHostelContactDetails,
  getActiveUniversities,
  updateHostel,
  deleteHostel,
} = require('../controllers/hostelController');

const {
  protect,
  authorizeRoles,
} = require('../middleware/authMiddleware');

const {
  isOwnerApproved,
} = require('../middleware/verificationMiddleware');

const checkMaintenanceMode = require('../middleware/maintenanceMiddleware');
const {
  createHostelSearchCacheKey,
  responseCache,
} = require('../middleware/cacheMiddleware');

/*
|--------------------------------------------------------------------------
| OWNER ROUTES
|--------------------------------------------------------------------------
*/

// Get owner's hostels
router.get(
  '/owner',
  protect,
  authorizeRoles('owner'),
  getOwnerHostels
);

// Create hostel
router.post(
  '/',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  isOwnerApproved,
  createHostel
);

/*
|--------------------------------------------------------------------------
| PUBLIC ROUTES
|--------------------------------------------------------------------------
*/



// Get active universities
router.get(
  '/active-universities',
  getActiveUniversities
);

// Get all hostels
router.get(
  '/',
  responseCache({
    ttl: 300,
    keyBuilder: (req) => createHostelSearchCacheKey(req.query),
  }),
  getHostels
);

// Get single hostel
router.get(
  '/:id',
  getSingleHostel
);

// Get owner contact details (Booking-Gated)
router.get(
  '/:id/contact',
  protect,
  getHostelContactDetails
);

// Get rooms for hostel
router.get(
  '/:id/rooms',
  getHostelRooms
);

// Update hostel
router.put(
  '/:id',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  updateHostel
);

// Delete hostel
router.delete(
  '/:id',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  deleteHostel
);

module.exports = router;
