process.env.UV_THREADPOOL_SIZE = 64;
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

require('dotenv').config();

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

/* =========================================
   MIDDLEWARE
========================================= */
const path = require('path');
const analyticsTracker = require('./src/middleware/analyticsTracker');

const app = express();

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
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://172.20.10.4:3000',
  'https://adminrelaxly.netlify.app',
];

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);
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
app.use(morgan('dev'));

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

/* =========================================
   API ROUTES
========================================= */
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes); 
app.use('/api/admin/owners', ownerOperationsRoutes); 
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/users', userRoutes); // Handle frontend calling without /api prefix
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
app.use('/payouts', payoutRoutes); // Handle frontend calling without /api prefix

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
const { startPayoutWorker } = require('./src/workers/payoutWorker');
const { startReservationExpiryWorker } = require('./src/workers/reservationExpiryWorker');
const { startCommunicationWorker } = require('./src/workers/communicationWorker');

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    startPayoutWorker();
    startReservationExpiryWorker();
    startCommunicationWorker();
});

