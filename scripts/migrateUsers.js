const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

dotenv.config();

const migrateUsers = async () => {
  try {
    await connectDB();

    console.log('--- Starting User Migration ---');

    // We use .find().cursor() to handle large datasets efficiently
    const cursor = User.find({}).cursor();
    let totalUsers = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (let user = await cursor.next(); user != null; user = await cursor.next()) {
      totalUsers++;
      let needsUpdate = false;
      const updates = {};
      const unsets = {};

      // Accessing raw data to see legacy fields not in schema
      const rawUser = user.toObject({ virtuals: false, transform: false, getters: false, minimize: false });

      // A. Email Verification Migration
      if (rawUser.isEmailVerified === undefined && rawUser.isVerified !== undefined) {
        user.isEmailVerified = rawUser.isVerified;
        needsUpdate = true;
        console.log(`[${user.email}] Migrating isEmailVerified from isVerified (${rawUser.isVerified})`);
      }

      // B. Student Rules
      if (user.role === 'student') {
        if (user.verificationStatus !== 'rejected' && user.verificationStatus !== 'approved') {
          user.verificationStatus = 'approved';
          user.isStudentVerified = true;
          needsUpdate = true;
          console.log(`[${user.email}] Setting student to approved/verified`);
        } else if (user.verificationStatus === 'approved' && !user.isStudentVerified) {
            user.isStudentVerified = true;
            needsUpdate = true;
            console.log(`[${user.email}] Ensuring approved student is isStudentVerified: true`);
        }
      }

      // C. Owner Rules
      if (user.role === 'owner' && !user.verificationStatus) {
        user.verificationStatus = 'pending';
        needsUpdate = true;
        console.log(`[${user.email}] Setting owner status to pending`);
      }

      // D. Remove Legacy Field
      if (rawUser.isVerified !== undefined) {
        // To remove a field not in the schema from MongoDB, we must use $unset
        unsets.isVerified = "";
        needsUpdate = true;
      }

      if (needsUpdate) {
        try {
          // We use updateOne with $set and $unset to ensure the legacy field is actually removed from DB
          // and other fields are updated according to Mongoose logic
          const updateData = { $set: user.toObject() };
          if (Object.keys(unsets).length > 0) {
            updateData.$unset = unsets;
          }

          await User.updateOne({ _id: user._id }, updateData);
          updatedCount++;
        } catch (err) {
          console.error(`[${user.email}] Update failed:`, err.message);
          errorCount++;
        }
      }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Total users found: ${totalUsers}`);
    console.log(`Total users updated: ${updatedCount}`);
    console.log(`Total errors: ${errorCount}`);
    console.log('--- Migration Completed ---');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Migration script failed: ${error.message}`);
    process.exit(1);
  }
};

migrateUsers();
