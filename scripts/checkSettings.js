const mongoose = require('mongoose');
require('dotenv').config();
const PlatformSettings = require('../src/models/PlatformSettings');
const connectDB = require('../src/config/db');

const checkSettings = async () => {
  try {
    await connectDB();
    const settings = await PlatformSettings.findOne();
    console.log('Settings:', JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

checkSettings();
