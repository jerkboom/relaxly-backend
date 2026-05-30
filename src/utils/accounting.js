/**
 * Determines the entry side (debit/credit) for a transaction based on its account category.
 * This mapping is used for future double-entry accounting normalization.
 * 
 * @param {string} accountCategory - The category of the account
 * @returns {string} - 'credit' or 'debit'
 */
const determineEntrySide = (accountCategory) => {
  const mapping = {
    asset: 'debit',
    expense: 'debit',
    settlement: 'debit',
    adjustment: 'debit',
    revenue: 'credit',
    liability: 'credit',
    reserve: 'credit',
  };

  return mapping[accountCategory] || 'debit';
};

/**
 * Validates the balance of a journal group (sum of debits vs sum of credits).
 * Used for observability and future double-entry enforcement.
 * 
 * @param {Array} entries - Array of ledger entries
 * @returns {Object} - Balance results { debitTotal, creditTotal, balanced, difference }
 */
const validateJournalGroupBalance = (entries) => {
  const totals = entries.reduce(
    (acc, entry) => {
      const amount = Number(entry.amount) || 0;
      if (entry.entrySide === 'debit') {
        acc.debitTotal += amount;
      } else if (entry.entrySide === 'credit') {
        acc.creditTotal += amount;
      }
      return acc;
    },
    { debitTotal: 0, creditTotal: 0 }
  );

  // Round to 2 decimal places to avoid floating point issues
  totals.debitTotal = Math.round(totals.debitTotal * 100) / 100;
  totals.creditTotal = Math.round(totals.creditTotal * 100) / 100;

  const difference = Math.abs(totals.debitTotal - totals.creditTotal);
  const balanced = difference === 0;

  return {
    ...totals,
    balanced,
    difference: Math.round(difference * 100) / 100,
  };
};

module.exports = {
  determineEntrySide,
  validateJournalGroupBalance,
};
