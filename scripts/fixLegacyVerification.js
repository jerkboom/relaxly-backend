const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/User');
const connectDB = require('../src/config/db');

dotenv.config();

/**
 * Migration: fixLegacyVerification
 * 
 * Purpose:
 * Fixes verification flags for legacy users who have isVerified: true but isEmailVerified: false.
 * This handles the case where the schema default (false) prevented previous migrations from detecting
 * that these users were already verified in the legacy system.
 * 
 * Requirements:
 * 1. Find all users where isVerified === true AND isEmailVerified === false.
 * 2. Update isEmailVerified = true.
 * 3. For students, set verificationStatus = 'approved' and isStudentVerified = true.
 * 4. Remove the legacy field isVerified using $unset.
 * 5. Do NOT modify rejected or suspended owners.
 */

const fixLegacyVerification = async () => {
  try {
    await connectDB();

    console.log('--- Starting Legacy Verification Fix ---');

    // Filter: isVerified: true (legacy field) and isEmailVerified: false (current field)
    // We use .lean() to ensure we can access the legacy isVerified field not defined in the schema.
    const query = {
      isVerified: true,
      isEmailVerified: false
    };

    const users = await User.find(query).lean();
    
    console.log(`Found ${users.length} users matching criteria.`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      // 5. Do NOT modify: rejected owners, suspended owners.
      // We check for verificationStatus === 'rejected' for owners.
      // We also check for an 'isSuspended' field in case it exists in raw data.
      const isRejectedOwner = user.role === 'owner' && user.verificationStatus === 'rejected';
      const isSuspended = user.isSuspended === true;

      if (isRejectedOwner || isSuspended) {
        console.log(`[${user.email}] Skipping: ${isRejectedOwner ? 'Rejected Owner' : 'Suspended'}`);
        skippedCount++;
        continue;
      }

      const updateSet = {
        isEmailVerified: true
      };

      // 3. If role === 'student': verificationStatus = 'approved', isStudentVerified = true
      if (user.role === 'student') {
        updateSet.verificationStatus = 'approved';
        updateSet.isStudentVerified = true;
      }

      const updateUnset = {
        isVerified: ""
      };

      try {
        // 7. Use safe update logic only: updateOne with explicit $set and $unset.
        // We do NOT use user.save() or user.toObject() as requested.
        await User.updateOne(
          { _id: user._id },
          { 
            $set: updateSet, 
            $unset: updateUnset 
          }
        );
        console.log(`[${user.email}] Successfully updated. (Role: ${user.role})`);
        updatedCount++;
      } catch (err) {
        console.error(`[${user.email}] Update failed:`, err.message);
        errorCount++;
      }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Total users found:     ${users.length}`);
    console.log(`Total users updated:   ${updatedCount}`);
    console.log(`Total users skipped:   ${skippedCount}`);
    console.log(`Total errors:          ${errorCount}`);
    console.log('--- Migration Completed ---');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Migration script failed: ${error.message}`);
    process.exit(1);
  }
};

fixLegacyVerification();
