const mongoose = require('mongoose');
const dotenv = require('dotenv');
const OwnerInviteCode = require('./src/models/OwnerInviteCode');

dotenv.config();

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    console.log('Testing create with expiresAt: null');
    const invite = await OwnerInviteCode.create({
      code: 'TEST-CODE-' + Math.floor(Math.random() * 1000),
      assignedToEmail: 'test@example.com',
      createdBy: new mongoose.Types.ObjectId(), // Dummy ID
      expiresAt: null,
      neverExpires: true
    });

    console.log('SUCCESS:', invite._id);
    process.exit(0);
  } catch (error) {
    console.error('FAILURE:', error.message);
    if (error.errors) {
        console.log('Validation Errors:', Object.keys(error.errors));
    }
    process.exit(1);
  }
};

test();
