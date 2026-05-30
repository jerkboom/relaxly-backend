const express = require('express');
const router = express.Router();

const {
  createRoom,
  getRooms,
  getSingleRoom,
  updateRoom,
  deleteRoom,
} = require('../controllers/roomController');

const {
  protect,
  authorizeRoles,
} = require('../middleware/authMiddleware');

const checkMaintenanceMode = require('../middleware/maintenanceMiddleware');

// GET ALL ROOMS
router.get('/', getRooms);

// GET SINGLE ROOM
router.get('/:id', getSingleRoom);

// CREATE ROOM
router.post(
  '/',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  createRoom
);

// UPDATE ROOM
router.put(
  '/:id',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  updateRoom
);

// DELETE ROOM
router.delete(
  '/:id',
  protect,
  checkMaintenanceMode,
  authorizeRoles('owner'),
  deleteRoom
);

module.exports = router;
