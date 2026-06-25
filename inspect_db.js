const mongoose = require('mongoose');
require('dotenv').config();

const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.error('Error: MONGO_URI is not defined in the environment variables.');
  process.exit(1);
}

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected!');

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  const Transaction = mongoose.model('TransactionLedger', new mongoose.Schema({}, { strict: false }), 'transactionledgers');

  console.log('\n--- FETCHING RECENT STUDENTS ---');
  const students = await User.find({ role: 'student' }).limit(5);
  students.forEach(s => {
    const raw = s.toObject();
    console.log(`Student: Name="${raw.name}" Email="${raw.email}" ID="${raw._id}"`);
    console.log('Raw keys:', Object.keys(raw));
    console.log('Specific keys of interest:');
    console.log(' - phone:', raw.phone);
    console.log(' - studentId:', raw.studentId);
    console.log(' - studentNumber:', raw.studentNumber);
    console.log(' - indexNumber:', raw.indexNumber);
    console.log(' - customUniversity:', raw.customUniversity);
    console.log(' - university:', raw.university);
    console.log('-----------------------------');
  });

  if (students.length > 0) {
    const targetStudentId = students[0]._id;
    console.log(`\n--- FETCHING BOOKINGS FOR STUDENT: ${students[0].name} (${targetStudentId}) ---`);
    const bookings = await Booking.find({ student: targetStudentId });
    console.log(`Found ${bookings.length} bookings.`);
    bookings.forEach(b => {
      const raw = b.toObject();
      console.log('Booking Code:', raw.bookingCode);
      console.log('Booking Status:', raw.bookingStatus);
      console.log('Payment Status:', raw.paymentStatus);
      console.log('Amount:', raw.amount);
      console.log('Checked In:', raw.checkedIn);
      console.log('Checked In At:', raw.checkedInAt);
      console.log('Assigned Room Number:', raw.assignedRoomNumber);
      console.log('Assigned Bed Number:', raw.assignedBedNumber);
      console.log('Keys:', Object.keys(raw));
      console.log('-----------------------------');
    });

    console.log(`\n--- FETCHING TRANSACTIONS FOR STUDENT: ${targetStudentId} ---`);
    const transactions = await Transaction.find({
      $or: [
        { sender: targetStudentId },
        { recipient: targetStudentId }
      ]
    });
    console.log(`Found ${transactions.length} transactions.`);
    transactions.forEach(t => {
      const raw = t.toObject();
      console.log('Type:', raw.type);
      console.log('Amount:', raw.amount);
      console.log('Status:', raw.status);
      console.log('Reference:', raw.reference);
      console.log('Direction:', raw.direction);
      console.log('Keys:', Object.keys(raw));
      console.log('-----------------------------');
    });
  }

  await mongoose.disconnect();
  console.log('Done!');
}

run().catch(console.error);
