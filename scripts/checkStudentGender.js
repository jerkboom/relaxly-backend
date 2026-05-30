const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

const checkStudent = async () => {
  try {
    await connectDB();
    const student = await User.findOne({ email: 'test@example.com' });
    console.log('Student Gender:', student.gender);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

checkStudent();
