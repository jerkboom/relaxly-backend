const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

const findStudent = async () => {
  try {
    await connectDB();
    const student = await User.findOne({ role: 'student' });
    if (student) {
      console.log('Found student:', student.email);
    } else {
      console.log('No student found');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

findStudent();
