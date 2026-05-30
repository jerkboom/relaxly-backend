require('dotenv').config();
const mongoose = require('mongoose');
const PayoutQueue = require('./src/models/PayoutQueue');
const Booking = require('./src/models/Booking');
const Hostel = require('./src/models/Hostel');

const migrate = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const payouts = await PayoutQueue.find({});
    console.log(`Found ${payouts.length} payouts to check`);

    for (const payout of payouts) {
      let updated = false;
      let corrupted = false;

      // Backfill amounts
      if (payout.grossAmount === undefined || payout.grossAmount === null) {
        payout.grossAmount = payout.amount || 0;
        updated = true;
      }
      if (payout.platformFee === undefined || payout.platformFee === null) {
        payout.platformFee = payout.commissionAmount || 0;
        updated = true;
      }
      if (payout.netAmount === undefined || payout.netAmount === null) {
        payout.netAmount = payout.finalTransferAmount || 0;
        updated = true;
      }

      // Check integrity
      if (!payout.booking || !payout.owner || (payout.grossAmount === 0 && payout.netAmount === 0)) {
        
        // Try to recover booking if possible
        if (!payout.booking && payout.metadata?.reference) {
           const booking = await Booking.findOne({ paymentReference: payout.metadata.reference });
           if (booking) {
             payout.booking = booking._id;
             payout.owner = payout.owner || (await Hostel.findById(booking.hostel))?.owner;
             payout.hostel = payout.hostel || booking.hostel;
             updated = true;
           }
        }

        if (!payout.booking || !payout.owner) {
          payout.integrityStatus = 'corrupted';
          updated = true;
          corrupted = true;
        } else {
          payout.integrityStatus = 'valid';
          updated = true;
        }
      } else if (payout.integrityStatus !== 'valid') {
        payout.integrityStatus = 'valid';
        updated = true;
      }

      if (updated) {
        await payout.save();
        console.log(`Updated payout ${payout._id} (Status: ${payout.integrityStatus})`);
      }
    }

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrate();
