const mongoose = require('mongoose');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a database operation inside a MongoDB transaction with automatic retry on write conflicts.
 * Uses exponential backoff delays (100ms, 250ms, 500ms).
 *
 * @param {Function} transactionFn - Async function that executes the transaction logic. Receives the `session` object.
 * @param {number} maxRetries - Maximum number of retries before failing.
 * @returns {Promise<any>} - Resolves with the return value of transactionFn.
 */
const runTransactionWithRetry = async (transactionFn, maxRetries = 3) => {
  let retries = 0;
  const backoffDelays = [100, 250, 500];

  while (true) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      
      const result = await transactionFn(session);
      
      await session.commitTransaction();
      session.endSession();
      return result;
    } catch (error) {
      // Abort the transaction if still active
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.error('[TRANSACTION HELPER] Abort failed:', abortError.message);
        }
      }
      session.endSession();

      const isWriteConflict = 
        error.code === 112 || 
        error.name === 'WriteConflict' ||
        error.message?.includes('WriteConflict') ||
        error.message?.includes('Write conflict') ||
        (error.errorLabels && error.errorLabels.includes('TransientTransactionError'));

      if (isWriteConflict && retries < maxRetries) {
        const baseDelayMs = backoffDelays[retries] || 500;
        // Add random jitter between 0 and 50ms to prevent lockstep retries (thundering herd)
        const jitter = Math.floor(Math.random() * 50);
        const delayMs = baseDelayMs + jitter;
        console.warn(`[TRANSACTION CONFLICT] Write conflict detected: ${error.message}. Retrying in ${delayMs}ms (base ${baseDelayMs}ms + jitter ${jitter}ms)... (Attempt ${retries + 1}/${maxRetries})`);
        retries++;
        await delay(delayMs);
        continue;
      }

      // If we ran out of retries and it was a write conflict
      if (isWriteConflict) {
        const limitError = new Error('High booking activity detected. Please try again.');
        limitError.statusCode = 429;
        throw limitError;
      }

      // For other types of errors, throw immediately
      throw error;
    }
  }
};

module.exports = { runTransactionWithRetry };
