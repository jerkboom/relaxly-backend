require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Hostel = require('../src/models/Hostel');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const PayoutQueue = require('../src/models/PayoutQueue');
const TransactionLedger = require('../src/models/TransactionLedger');

async function runDeepAudit() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // 1. Transaction Ledger Orphans
    const ledgers = await TransactionLedger.find();
    let orphanedLedgers = 0;
    const validBookingIds = new Set((await Booking.find().select('_id')).map(b => b._id.toString()));
    
    for (const l of ledgers) {
      if (!l.booking || !validBookingIds.has(l.booking.toString())) {
        orphanedLedgers++;
      }
    }

    console.log(`Orphaned Ledgers: ${orphanedLedgers}`);
    
    // 2. What owner profiles are affected?
    // Since ledger doesn't have owner, maybe we can look at the reference string?
    // reference: "hh-6a0efc6de8ee9e03ea625b4d-..." -> The booking ID is in the reference!
    const affectedOwners = new Set();
    
    for (const l of ledgers) {
       if (!l.booking || !validBookingIds.has(l.booking.toString())) {
          // Can we extract booking ID from reference?
          if (l.reference && l.reference.startsWith('hh-')) {
            const parts = l.reference.split('-');
            if (parts.length >= 2) {
               const potentialBookingId = parts[1];
               // We can't easily find the owner if the booking is deleted, unless the hostel still exists.
               // But wait, if the booking is deleted, the hostel might still exist.
            }
          }
       }
    }
    
    // 3. Let's check for "null references" as literal strings "null" or missing ObjectIds
    let badHostelOwners = 0;
    const hostels = await Hostel.find();
    for (const h of hostels) {
      if (!h.owner) badHostelOwners++;
    }

    let badRoomHostels = 0;
    const rooms = await Room.find();
    for (const r of rooms) {
      if (!r.hostel) badRoomHostels++;
    }

    console.log(`Bad Hostel Owners: ${badHostelOwners}`);
    console.log(`Bad Room Hostels: ${badRoomHostels}`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

runDeepAudit();