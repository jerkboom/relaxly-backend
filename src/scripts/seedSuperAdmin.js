const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const Admin = require('../models/Admin');

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

const seedSuperAdmin = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not configured');
    }
    if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
      throw new Error(
        'SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set in .env before running this script'
      );
    }

    await mongoose.connect(process.env.MONGO_URI);

    const existingAdmin = await Admin.findOne({ email: SUPER_ADMIN_EMAIL });

    if (existingAdmin) {
      console.log('Super admin already exists');
      return;
    }

    const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

    await Admin.create({
      name: 'Super Admin',
      email: SUPER_ADMIN_EMAIL,
      password: hashedPassword,
      role: 'super_admin',
      permissions: ['*'],
      isActive: true,
      status: 'active',
      mustResetPassword: true,
      mfaEnabled: false,
    });

    console.log(`Super admin created: ${SUPER_ADMIN_EMAIL}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seedSuperAdmin();

