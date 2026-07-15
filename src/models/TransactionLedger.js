const mongoose = require('mongoose');

const transactionLedgerSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'payment',
        'service_fee',
        'owner_payout',
        'owner_payout_initiated',
        'owner_payout_completed',
        'owner_payout_failed',
        'paystack_fee',
        'platform_commission',
        'platform_adjustment',
        'tax_reserve',
        'adjustment',
        'failed_transfer',
        'student_payment',
        'platform_fee',
        'ambassador_commission',
        'ambassador_payout',
        'ambassador_commission_expense',
        'ambassador_payable'
      ],
      required: true,
    },

    accountCategory: {
      type: String,
      enum: [
        'revenue',
        'liability',
        'expense',
        'asset',
        'settlement',
        'reserve',
        'adjustment',
      ],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: [0, 'Amount cannot be negative'],
    },

    direction: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },

    status: {
      type: String,
      required: true,
      default: 'success',
    },

    reference: {
      type: String,
      trim: true,
      index: true,
    },

    provider: {
      type: String,
      trim: true,
      default: 'system',
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    journalGroup: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },

    entrySide: {
      type: String,
      enum: ['debit', 'credit'],
    },
  },
  {
    timestamps: true,
  }
);

// IMMUTABILITY PROTECTION - Modern Async Hooks
// Prevent updates to ledger entries
transactionLedgerSchema.pre('save', async function () {
  if (!this.isNew) {
    throw new Error('Transaction ledger entries are immutable and cannot be modified.');
  }

  // REFERENTIAL INTEGRITY VALIDATION
  if (this.booking) {
    const bookingExists = await mongoose.model('Booking').exists({ _id: this.booking });
    if (!bookingExists) {
      throw new Error(`Referential Integrity Error: Booking with ID ${this.booking} does not exist.`);
    }
  }
});

// Block update operations
const blockUpdate = async function () {
  throw new Error('Transaction ledger entries are immutable and cannot be updated.');
};

transactionLedgerSchema.pre('updateOne', blockUpdate);
transactionLedgerSchema.pre('updateMany', blockUpdate);
transactionLedgerSchema.pre('findOneAndUpdate', blockUpdate);
transactionLedgerSchema.pre('findByIdAndUpdate', blockUpdate);
transactionLedgerSchema.pre('replaceOne', blockUpdate);
transactionLedgerSchema.pre('update', blockUpdate);

// Prevent deletion
const blockDelete = async function () {
  throw new Error('Transaction ledger entries are immutable and cannot be deleted.');
};

transactionLedgerSchema.pre('remove', blockDelete);
transactionLedgerSchema.pre('deleteOne', blockDelete);
transactionLedgerSchema.pre('deleteMany', blockDelete);
transactionLedgerSchema.pre('findOneAndDelete', blockDelete);

module.exports = mongoose.model('TransactionLedger', transactionLedgerSchema);
