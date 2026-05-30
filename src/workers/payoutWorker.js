const { processPendingPayouts } = require('../services/payoutService');

/**
 * Initializes the payout worker to run at a regular interval.
 * @param {number} intervalMs - The interval in milliseconds between runs.
 */
const startPayoutWorker = (intervalMs = 15 * 60 * 1000) => {
  console.log(`Payout Worker initialized but AUTOMATIC PAYOUTS ARE DISABLED per production rules.`);
  
  // To re-enable later, uncomment the execution logic below:
    processPendingPayouts().catch(err => {
     console.error('Error in initial payout worker run:', err.message);
    });
  
     const interval = setInterval(async () => {
       try {
         await processPendingPayouts();
       } catch (err) {
        console.error('Error in payout worker interval run:', err.message);
      }
     }, intervalMs);
    
      return interval;
  
  return null;
};

module.exports = {
  startPayoutWorker
};
