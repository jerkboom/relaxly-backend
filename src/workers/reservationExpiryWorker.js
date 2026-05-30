const { cleanupExpiredReservations, logLifecycleEvent } = require('../utils/bookingLifecycle');

const startReservationExpiryWorker = (intervalMs = 60 * 1000) => {
  logLifecycleEvent('reservation_expiry_worker_started', {
    intervalMs,
  });

  cleanupExpiredReservations().catch((error) => {
    console.error('Error in initial reservation expiry worker run:', error.message);
  });

  const interval = setInterval(async () => {
    try {
      await cleanupExpiredReservations();
    } catch (error) {
      console.error('Error in reservation expiry worker interval run:', error.message);
    }
  }, intervalMs);

  return interval;
};

module.exports = {
  startReservationExpiryWorker,
};
