const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');

require('dotenv').config();

/* =========================================
   DATABASE
========================================= */
const connectDB = require('./src/config/db');

/* =========================================
   MODELS
========================================= */
const User = require('./src/models/User');

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

/* =========================================
   MIDDLEWARE
========================================= */
const {
  notFound,
  errorHandler,
} = require('./src/middleware/errorMiddleware');

const app = express();

/* =========================================
   CONNECT DATABASE
========================================= */
connectDB();

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
app.use(
  express.json({
    limit: '100kb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '100kb',
  })
);

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
  'http://127.0.0.1:3000',
  'http://172.20.10.4:3000',

  // NETLIFY FRONTEND
  'https://lucent-syrniki-08c845.netlify.app',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin
      // like mobile apps or postman
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error(
          `CORS blocked for origin: ${origin}`
        )
      );
    },

    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* =========================================
   SECURITY
========================================= */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(mongoSanitize());

/* =========================================
   LOGGER
========================================= */
app.use(morgan('dev'));

/* =========================================
   RATE LIMITER
========================================= */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message:
    'Too many requests from this IP. Please try again later.',
});

app.use(limiter);

/* =========================================
   HTTP SERVER
========================================= */
const server = http.createServer(app);

/* =========================================
   SOCKET.IO
========================================= */
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },

  transports: ['websocket', 'polling'],
});

/* =========================================
   ATTACH SOCKET TO APP
========================================= */
app.set('io', io);

/* =========================================
   ONLINE USERS TRACKER
========================================= */
const onlineUsers = new Map();

const getOnlineUserIds = () =>
  Array.from(onlineUsers.keys());

const addOnlineSocket = (
  userId,
  socketId
) => {
  const sockets =
    onlineUsers.get(userId) || new Set();

  sockets.add(socketId);

  onlineUsers.set(userId, sockets);
};

const removeOnlineSocket = (
  userId,
  socketId
) => {
  const sockets =
    onlineUsers.get(userId);

  if (!sockets) return;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    onlineUsers.delete(userId);
  }
};

/* =========================================
   ROOT TEST ROUTE
========================================= */
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message:
      'Hostel Booking API Running Successfully',
  });
});

/* =========================================
   API ROUTES
========================================= */
app.use('/api/auth', authRoutes);

app.use('/api/users', userRoutes);

app.use(
  '/api/universities',
  universityRoutes
);

app.use('/api/hostels', hostelRoutes);

app.use('/api/rooms', roomRoutes);

app.use('/api/bookings', bookingRoutes);

app.use(
  '/api/dashboard',
  dashboardRoutes
);

app.use('/api/upload', uploadRoutes);

app.use('/api/reviews', reviewRoutes);

app.use(
  '/api/favorites',
  favoriteRoutes
);

app.use(
  '/api/analytics',
  analyticsRoutes
);

app.use(
  '/api/notifications',
  notificationRoutes
);

app.use('/api/payments', paymentRoutes);

app.use('/api/receipts', receiptRoutes);

/* =========================================
   SOCKET AUTHENTICATION
========================================= */
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token;

    if (!token) {
      return next(
        new Error('Authentication error')
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(
      decoded.id
    ).select('_id role');

    if (!user) {
      return next(
        new Error('Authentication error')
      );
    }

    socket.user = {
      id: user._id.toString(),
      role: user.role,
    };

    next();
  } catch (error) {
    console.error(
      'Socket authentication failed:',
      error.message
    );

    next(
      new Error('Authentication error')
    );
  }
});

/* =========================================
   SOCKET CONNECTION
========================================= */
io.on('connection', (socket) => {
  const userId = socket.user.id;

  console.log(
    `Socket connected: ${socket.id}`
  );

  console.log(
    `Authenticated user: ${userId}`
  );

  /* USER ROOM */
  socket.join(userId);

  /* TRACK ONLINE USER */
  addOnlineSocket(userId, socket.id);

  /* BROADCAST ONLINE USERS */
  io.emit(
    'onlineUsers',
    getOnlineUserIds()
  );

  /* =========================================
     DISCONNECT
  ========================================= */
  socket.on('disconnect', () => {
    removeOnlineSocket(
      userId,
      socket.id
    );

    io.emit(
      'onlineUsers',
      getOnlineUserIds()
    );

    console.log(
      `Socket disconnected: ${socket.id}`
    );
  });
});

/* =========================================
   404 HANDLER
========================================= */
app.use(notFound);

/* =========================================
   GLOBAL ERROR HANDLER
========================================= */
app.use(errorHandler);

/* =========================================
   PORT
========================================= */
const PORT =
  process.env.PORT || 5000;

/* =========================================
   START SERVER
========================================= */
server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);