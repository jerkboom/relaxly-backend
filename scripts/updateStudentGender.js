const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

const updateStudent = async () => {
  try {
    await connectDB();
    await User.findOneAndUpdate({ email: 'test@example.com' }, { gender: 'Male' });
    console.log('Student Gender updated to Male');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

updateStudent();
