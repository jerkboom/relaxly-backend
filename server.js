process.env.UV_THREADPOOL_SIZE = 64;
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

/* =========================================
   DATABASE
========================================= */
const connectDB = require('./src/config/db');

/* =========================================
   SOCKET MANAGER
========================================= */
const socketManager = require('./src/utils/socketManager');
const { initIO } = require('./src/socket');

/* =========================================
   ROUTES
========================================= */
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const universityRoutes = require('./src/routes/universityRoutes');
const hostelRoutes = require('./src/routes/hostelRoutes');
const roomRoutes = require('./src/routes/roomRoutes');
const bookingRoutes = require('./src/routes/bookingRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const favoriteRoutes = require('./src/routes/favoriteRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const receiptRoutes = require('./src/routes/receiptRoutes');
const communicationRoutes = require('./src/routes/communicationRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const financeRoutes = require('./src/routes/financeRoutes');
const payoutMethodRoutes = require('./src/routes/payoutMethodRoutes');
const ownerOperationsRoutes = require('./src/routes/ownerOperationsRoutes');
const payoutRoutes = require('./src/routes/payoutRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const ambassadorRoutes = require('./src/routes/ambassadorRoutes');

/* =========================================
   MIDDLEWARE
========================================= */
const path = require('path');
const analyticsTracker = require('./src/middleware/analyticsTracker');

const app = express();

app.set('trust proxy', 1);

/* =========================================
   CONNECT DATABASE
========================================= */
connectDB();

const systemMonitor = require('./src/utils/systemMonitor');

/* =========================================
   LATENCY TRACKER
========================================= */
app.use((req, res, next) => {
  const start = process.hrTime ? process.hrTime() : Date.now();
  res.on('finish', () => {
    const duration = process.hrTime ? process.hrTime(start)[1] / 1000000 : Date.now() - start;
    systemMonitor.recordLatency(duration);
  });
  next();
});

/* =========================================
   PAYSTACK WEBHOOK
========================================= */
app.use(
  '/api/payments/webhook',
  express.raw({
    type: 'application/json',
  })
);

/* =========================================
   BODY PARSERS
========================================= */
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

/* =========================================
   ANALYTICS TRACKER
========================================= */
app.use('/api', analyticsTracker);

/* =========================================
   EXPRESS 5 QUERY FIX
========================================= */
app.use((req, res, next) => {
  if (req.query) {
    const query = req.query;
    Object.defineProperty(req, 'query', {
      value: query,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  next();
});

/* =========================================
   CORS
========================================= */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  ...(process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim())
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// 👇 Restored this back to your correct Express 5 format!
app.options('/{*splat}', cors());

/* =========================================
   SECURITY
========================================= */
const { globalLimiter, bookingLimiter, adminLimiter } = require('./src/middleware/rateLimiter');

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(mongoSanitize());
app.use('/api', globalLimiter);
app.use('/api/admin', adminLimiter);
app.use('/api/bookings', bookingLimiter);

/* =========================================
   LOGGER
========================================= */
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Specific stricter limit for admin login
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per `window`
  message: 'Too many login attempts from this IP, please try again after 15 minutes',
});
app.use('/api/auth/login', adminLoginLimiter);

// Relaxed limit for notifications to prevent 429 during normal polling
const notificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many notification requests. Please try again later.',
});
app.use('/api/notifications', notificationLimiter);


/* =========================================
   HTTP SERVER & SOCKET.IO
========================================= */
const server = http.createServer(app);
const io = initIO(server);
app.set('io', io);

/* =========================================
   ROOT & HEALTH ROUTES
========================================= */
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Hostel Booking API Running Successfully',
  });
});

app.get('/api/health', async (req, res) => {
  // Check database connection state
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const dbState = mongoose.connection.readyState;
  const isHealthy = dbState === 1;

  if (isHealthy) {
    return res.status(200).json({
      status: 'OK',
      database: 'Connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } else {
    // If the DB is down, return a 503 Service Unavailable
    return res.status(503).json({
      status: 'DEGRADED',
      database: 'Disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

/* =========================================
   API ROUTES
========================================= */
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes); 
app.use('/api/admin/owners', ownerOperationsRoutes); 
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/users', userRoutes); // Handle frontend calling without /api prefix
app.use('/api/platform', require('./src/routes/platformRoutes'));
app.use('/platform', require('./src/routes/platformRoutes'));
app.use('/api/universities', universityRoutes);
app.use('/universities', universityRoutes);
app.use('/api/hostels', hostelRoutes);
app.use('/hostels', hostelRoutes); 
app.use('/api/rooms', roomRoutes);
app.use('/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/bookings', bookingRoutes);
app.use('/api/payout-method', payoutMethodRoutes);
app.use('/payout-method', payoutMethodRoutes); // Handle frontend calling without /api prefix
app.use('/api/dashboard', dashboardRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/reviews', reviewRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/notifications', notificationRoutes); 
app.use('/api/communication', communicationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/messages', messageRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/payments', paymentRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/owner/reports', reportRoutes);
app.use('/payouts', payoutRoutes); // Handle frontend calling without /api prefix
app.use('/api/ambassadors', ambassadorRoutes);
app.use('/ambassadors', ambassadorRoutes);

/* =========================================
   ERROR HANDLING (Must be at the very end!)
========================================= */
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

// 1. Catch 404s (Route doesn't exist)
app.use(notFoundHandler);

// 2. The Global Error Handler Net
app.use(errorHandler);

/* =========================================
   START SERVER
========================================= */
const cron = require('node-cron');
const { cleanupExpiredReservations } = require('./src/utils/bookingLifecycle');
const { processPendingPayouts } = require('./src/services/payoutService');
const { notifyAdmins } = require('./src/services/notificationService');

const notifySystemFailure = async ({ workflow, title, error }) => {
  try {
    await notifyAdmins({
      role: 'super_admin',
      title,
      message: `Workflow: ${workflow}\nError: ${error.message}`,
      subject: title,
      idempotencyKey: `system_failure:${workflow}:${new Date().toISOString().slice(0, 16)}`,
      type: 'system',
      data: {
        workflow,
        error: error.message
      }
    });
  } catch (notifyErr) {
    console.error('[SYSTEM_FAILURE_NOTIFICATION_ERROR]', notifyErr.message);
  }
};

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    
    // Start lightweight background cron schedules instead of heavy Redis workers
    cron.schedule('*/5 * * * *', async () => {
      try {
        const expiredCount = await cleanupExpiredReservations();
        if (expiredCount > 0) {
          console.log(`[CRON] Cleaned up ${expiredCount} expired reservations`);
        }
      } catch (err) {
        console.error('[CRON ERROR] Booking cleanup failed:', err.message);
        await notifySystemFailure({
          workflow: 'booking_cleanup_cron',
          title: 'Failed Cron Job: Booking Cleanup',
          error: err
        });
      }
    });

    cron.schedule('*/15 * * * *', async () => {
      try {
        await processPendingPayouts();
        console.log('[CRON] Payout check completed');
      } catch (err) {
        console.error('[CRON ERROR] Payout check failed:', err.message);
        await notifySystemFailure({
          workflow: 'payout_check_cron',
          title: 'Failed Cron Job: Payout Check',
          error: err
        });
      }
    });

    // Process/Retry queued emails from CommunicationQueue
    cron.schedule('*/1 * * * *', async () => {
      try {
        const { processCommunicationTask } = require('./src/services/notificationService');
        const CommunicationQueue = require('./src/models/CommunicationQueue');
        const pendingTasks = await CommunicationQueue.find({
          status: { $in: ['PENDING', 'FAILED'] },
          attempts: { $lt: 3 },
          nextAttemptAt: { $lte: new Date() }
        }).sort({ priority: -1, createdAt: 1 }).limit(20);

        for (const task of pendingTasks) {
          try {
            await processCommunicationTask(task._id);
          } catch (taskErr) {
            console.error(`[CRON ERROR] Retrying task ${task._id} failed:`, taskErr.message);
          }
        }
      } catch (err) {
        console.error('[CRON ERROR] Communication Queue check failed:', err.message);
      }
    });

    // Send hourly hostel moderation digest
    cron.schedule('0 * * * *', async () => {
      try {
        const notificationService = require('./src/services/notificationService');
        await notificationService.sendHostelModerationDigest();
      } catch (err) {
        console.error('[CRON ERROR] Hostel moderation digest failed:', err.message);
        await notifySystemFailure({
          workflow: 'hostel_moderation_digest_cron',
          title: 'Failed Cron Job: Hostel Moderation Digest',
          error: err
        });
      }
    });
});
