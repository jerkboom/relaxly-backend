const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, required: true },
  targetGroup: { 
    type: String, 
    enum: [
      'ALL', 
      'STUDENTS', 
      'OWNERS', 
      'AMBASSADORS', 
      'UNIVERSITY', 
      'HOSTEL', 
      'VERIFIED_OWNERS', 
      'STUDENTS_WITH_BOOKINGS', 
      'STUDENTS_WITHOUT_BOOKINGS'
    ], 
    required: true 
  },
  filters: {
    university: { type: String },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' }
  },
  channels: [{ type: String, enum: ['EMAIL', 'APP'], required: true }],
  status: { type: String, enum: ['PENDING', 'SENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Broadcast', broadcastSchema);
