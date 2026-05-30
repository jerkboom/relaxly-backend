const mongoose = require('mongoose');
require('dotenv').config();
const Room = require('../src/models/Room');
const connectDB = require('../src/config/db');

const TARGET_ROOM_ID = '69ff859883633e5092882b89';

const updateRoom = async () => {
  try {
    await connectDB();
    const room = await Room.findById(TARGET_ROOM_ID);
    if (!room) {
      console.log('Room not found');
      return;
    }

    // Fix validation errors in existing data if any
    if (!room.occupancyStyle) room.occupancyStyle = '1-in-1';
    if (room.billingPeriod === 'academic-year') room.billingPeriod = 'academic year';

    room.capacity = 500; // Increase capacity to allow for more beds
    room.maleAvailableBeds = 100;
    room.femaleAvailableBeds = 100;
    room.roomStatus = 'available';
    
    await room.save();
    
    console.log('Room beds reset to 100 each. Total available:', room.availableBeds);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

updateRoom();
