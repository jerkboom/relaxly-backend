const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

const checkOwner = async () => {
  try {
    await connectDB();
    const owner = await User.findById('6a0271a1133df8a87930dd6f');
    console.log('Owner Commission Rate:', owner.commissionRate);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

checkOwner();
