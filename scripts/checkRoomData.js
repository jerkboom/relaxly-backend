const mongoose = require('mongoose');
require('dotenv').config();
const Room = require('../src/models/Room');
const connectDB = require('../src/config/db');

const checkRoom = async () => {
  try {
    await connectDB();
    const room = await Room.findById('69ff859883633e5092882b89');
    console.log('Room Data:', JSON.stringify(room, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

checkRoom();
