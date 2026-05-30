const mongoose = require('mongoose');
require('dotenv').config();

const Booking = require('../src/models/Booking');
const PayoutQueue = require('../src/models/PayoutQueue');
const Hostel = require('../src/models/Hostel');
const connectDB = require('../src/config/db');

const migrate = async () => {
  try {
    await connectDB();
    console.log('Connected to DB for migration');
    
    const paidBookings = await Booking.find({ paymentStatus: 'paid' });
    let created = 0;
    
    for (const booking of paidBookings) {
      const existing = await PayoutQueue.findOne({ booking: booking._id });
      if (!existing) {
        const hostel = await Hostel.findById(booking.hostel).select('owner');
        if (!hostel) {
          console.log(`Hostel not found for booking ${booking._id}, skipping.`);
          continue;
        }
        
        let status = 'pending';
        if (booking.ownerPayoutStatus === 'paid') status = 'paid';
        else if (booking.ownerPayoutStatus === 'processing') status = 'processing';
        else if (booking.ownerPayoutStatus === 'failed') status = 'failed';
        
        await PayoutQueue.create({
          booking: booking._id,
          owner: hostel.owner,
          hostel: booking.hostel,
          amount: booking.ownerAmount || 0,
          commissionAmount: booking.adminCommission || 0,
          paystackFee: booking.paystackFee || 0,
          finalTransferAmount: (booking.ownerAmount || 0) - (booking.paystackFee || 0),
          currency: booking.currency || 'GHS',
          status,
          metadata: { info: 'Migrated from booking state' },
          paystackTransferReference: booking.ownerPayoutReference,
          processedAt: booking.ownerPayoutDate
        });
        created++;
      }
    }
    
    console.log(`Migration complete. Created ${created} missing PayoutQueue entries.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrate();
