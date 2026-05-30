const asyncHandler = require('express-async-handler');
const Room = require('../models/Room');
const Hostel = require('../models/Hostel');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const normalizeRoomAvailabilityInput = (body) => {
  const capacity = Number(body.capacity || 0);
  const requestedAvailableBeds = Number(
    body.availableBeds === undefined ? capacity : body.availableBeds
  );
  const clampedAvailableBeds = Math.max(
    0,
    Math.min(requestedAvailableBeds, capacity)
  );
  const genderAllocation = body.genderAllocation || 'Mixed';

  let maleAvailableBeds =
    body.maleAvailableBeds === undefined ? null : Number(body.maleAvailableBeds);
  let femaleAvailableBeds =
    body.femaleAvailableBeds === undefined ? null : Number(body.femaleAvailableBeds);

  if (genderAllocation === 'Male') {
    maleAvailableBeds = maleAvailableBeds ?? clampedAvailableBeds;
    femaleAvailableBeds = 0;
  } else if (genderAllocation === 'Female') {
    maleAvailableBeds = 0;
    femaleAvailableBeds = femaleAvailableBeds ?? clampedAvailableBeds;
  } else if (maleAvailableBeds === null && femaleAvailableBeds === null) {
    maleAvailableBeds = Math.ceil(clampedAvailableBeds / 2);
    femaleAvailableBeds = clampedAvailableBeds - maleAvailableBeds;
  } else {
    maleAvailableBeds = maleAvailableBeds ?? 0;
    femaleAvailableBeds = femaleAvailableBeds ?? 0;
  }

  return {
    ...body,
    availableBeds: maleAvailableBeds + femaleAvailableBeds,
    maleAvailableBeds,
    femaleAvailableBeds,
    genderAllocation,
  };
};

const assertOwnerCanManageHostel = async (hostelId, userId) => {
  const hostel = await Hostel.findById(hostelId).select('owner');
  if (!hostel) {
    const error = new Error('Hostel not found');
    error.statusCode = 404;
    throw error;
  }
  if (hostel.owner.toString() !== userId) {
    const error = new Error('Not authorized to manage rooms for this hostel');
    error.statusCode = 403;
    throw error;
  }
  return hostel;
};

const pickRoomFields = (body) => {
  const allowedFields = [
    'roomType',
    'occupancyStyle',
    'price',
    'billingPeriod',
    'capacity',
    'availableBeds',
    'maleAvailableBeds',
    'femaleAvailableBeds',
    'privateWashroom',
    'hasAC',
    'images',
    'featuredImage',
    'genderAllocation',
    'amenities',
    'description',
    'roomStatus',
  ];
  const update = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      update[field] = body[field];
    }
  });
  return update;
};

// CREATE ROOM
const createRoom = asyncHandler(async (req, res) => {
  const {
    hostel,
    roomType,
    occupancyStyle,
    price,
    billingPeriod,
    capacity,
    availableBeds,
    maleAvailableBeds,
    femaleAvailableBeds,
    privateWashroom,
    hasAC,
    images,
    featuredImage,
    genderAllocation,
    amenities,
    description,
    roomStatus,
  } = req.body;

  await assertOwnerCanManageHostel(hostel, req.user.id);

  const normalizedAvailability = normalizeRoomAvailabilityInput({
    capacity,
    availableBeds,
    maleAvailableBeds,
    femaleAvailableBeds,
    genderAllocation,
  });

  const room = await Room.create({
    hostel,
    roomType,
    occupancyStyle,
    price,
    billingPeriod,
    capacity,
    availableBeds: normalizedAvailability.availableBeds,
    maleAvailableBeds: normalizedAvailability.maleAvailableBeds,
    femaleAvailableBeds: normalizedAvailability.femaleAvailableBeds,
    privateWashroom,
    hasAC,
    images: images || [],
    featuredImage,
    genderAllocation: normalizedAvailability.genderAllocation,
    amenities: amenities || [],
    description,
    roomStatus: roomStatus || 'available',
    createdBy: req.user.id,
  });

  const populatedRoom = await Room.findById(room._id).populate(
    'hostel',
    '_id name location'
  );

  // Sync hostel room counts
  const totalRooms = await Room.countDocuments({ hostel });
  const availableRoomsCount = await Room.countDocuments({
    hostel,
    availableBeds: { $gt: 0 },
    roomStatus: 'available'
  });

  await Hostel.findByIdAndUpdate(hostel, {
    totalRooms,
    availableRooms: availableRoomsCount,
  });

  sendSuccess(res, populatedRoom, 'Room created successfully', 201);
});

// GET ALL ROOMS
const getRooms = asyncHandler(async (req, res) => {
  const { hostelId } = req.query;
  const filter = hostelId ? { hostel: hostelId } : {};
  
  const rooms = await Room.find(filter)
    .populate('hostel', '_id name location')
    .sort({ createdAt: -1 });

  sendSuccess(res, rooms, 'Rooms retrieved successfully');
});

// GET SINGLE ROOM
const getSingleRoom = asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id).populate(
    'hostel',
    '_id name location'
  );
  if (!room) {
    return sendError(res, 'Room not found', 404);
  }
  sendSuccess(res, room, 'Room details retrieved');
});

// UPDATE ROOM
const updateRoom = asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) {
    return sendError(res, 'Room not found', 404);
  }
  await assertOwnerCanManageHostel(room.hostel, req.user.id);

  const update = pickRoomFields(req.body);
  Object.assign(room, update);

  if (
    Object.prototype.hasOwnProperty.call(update, 'availableBeds') ||
    Object.prototype.hasOwnProperty.call(update, 'maleAvailableBeds') ||
    Object.prototype.hasOwnProperty.call(update, 'femaleAvailableBeds') ||
    Object.prototype.hasOwnProperty.call(update, 'genderAllocation') ||
    Object.prototype.hasOwnProperty.call(update, 'capacity')
  ) {
    const normalizedAvailability = normalizeRoomAvailabilityInput(room.toObject());
    room.availableBeds = normalizedAvailability.availableBeds;
    room.maleAvailableBeds = normalizedAvailability.maleAvailableBeds;
    room.femaleAvailableBeds = normalizedAvailability.femaleAvailableBeds;
    room.genderAllocation = normalizedAvailability.genderAllocation;
  }

  await room.save();

  const updatedRoom = await Room.findById(room._id).populate(
    'hostel',
    '_id name location'
  );

  // Sync hostel room counts if relevant fields changed
  const relevantFields = ['availableBeds', 'maleAvailableBeds', 'femaleAvailableBeds', 'roomStatus'];
  const shouldSync = relevantFields.some(field => Object.prototype.hasOwnProperty.call(req.body, field));

  if (shouldSync) {
    const availableRoomsCount = await Room.countDocuments({
      hostel: room.hostel,
      availableBeds: { $gt: 0 },
      roomStatus: 'available'
    });
    await Hostel.findByIdAndUpdate(room.hostel, { availableRooms: availableRoomsCount });
  }

  sendSuccess(res, updatedRoom, 'Room updated successfully');
});

// DELETE ROOM
const deleteRoom = asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) {
    return sendError(res, 'Room not found', 404);
  }
  await assertOwnerCanManageHostel(room.hostel, req.user.id);
  const hostelId = room.hostel;
  await room.deleteOne();

  // Sync hostel room counts
  const totalRoomsCount = await Room.countDocuments({ hostel: hostelId });
  const availableRoomsCount = await Room.countDocuments({
    hostel: hostelId,
    availableBeds: { $gt: 0 },
    roomStatus: 'available'
  });

  await Hostel.findByIdAndUpdate(hostelId, {
    totalRooms: totalRoomsCount,
    availableRooms: availableRoomsCount,
  });

  sendSuccess(res, null, 'Room deleted successfully');
});

module.exports = {
  createRoom,
  getRooms,
  getSingleRoom,
  updateRoom,
  deleteRoom,
};
