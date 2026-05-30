const mongoose = require('mongoose');
const User = require('../src/models/User');
require('dotenv').config();

const createAdmin = async () => {
  const adminDetails = {
    name: 'Super Admin',
    email: 'admin@hostel.com',
    password: 'Admin123!',
    role: 'admin',
    isEmailVerified: true,
    accountStatus: 'active'
  };

  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in .env file');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');

    // Check if admin already exists
    const adminExists = await User.findOne({ email: adminDetails.email });

    if (adminExists) {
      console.log('Admin already exists');
      process.exit(0);
    }

    // Create admin user
    // Note: The User model pre-save hook handles bcrypt hashing automatically
    await User.create(adminDetails);

    console.log('Admin user created successfully:');
    console.log(`Name: ${adminDetails.name}`);
    console.log(`Email: ${adminDetails.email}`);
    console.log(`Role: ${adminDetails.role}`);

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error.message);
    process.exit(1);
  }
};

createAdmin();
