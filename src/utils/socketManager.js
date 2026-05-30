const jwt = require('jsonwebtoken');
const User = require('../models/User');

class SocketManager {
  constructor() {
    this.io = null;
    this.onlineUsers = new Map();
  }

  init(io) {
    this.io = io;
    this.setupAuthentication();
    this.setupConnectionHandlers();
  }

  setupAuthentication() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) {
          // Allow connection without token (Guest)
          socket.user = null;
          return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id role accountStatus');
        
        // Normalize role check to lowercase
        if (!user || user.accountStatus.toLowerCase() !== 'active') {
            socket.user = null;
            return next();
        }

        socket.user = { id: user._id.toString(), role: user.role.toLowerCase() };
        next();
      } catch (error) {
        socket.user = null;
        next();
      }
    });
  }

  setupConnectionHandlers() {
    this.io.on('connection', (socket) => {
      // 1. JWT AUTO-REGISTRATION (Primary)
      if (socket.user) {
        const userId = socket.user.id;
        socket.join(userId); // Join personal room for targeted alerts
        console.log(`Socket ${socket.id} auto-joined room ${userId} (JWT verified)`);
        
        if (['super_admin', 'finance_admin', 'moderator', 'support_admin', 'admin'].includes(socket.user.role)) {
            socket.join('admin_channel'); // Global admin channel
        }

        this.addOnlineSocket(userId, socket.id);
        this.broadcastOnlineUsers();
      }

      // 2. MANUAL REGISTRATION (Fallback for legacy/debug clients)
      socket.on('register', (userId) => {
        if (userId) {
          socket.join(userId.toString());
          console.log(`Socket ${socket.id} manually joined room ${userId}`);
          this.addOnlineSocket(userId.toString(), socket.id);
          this.broadcastOnlineUsers();
        }
      });

      socket.on('disconnect', () => {
        if (socket.user) {
          this.removeOnlineSocket(socket.user.id, socket.id);
        }
        // Also attempt cleanup for manual registrations if possible
        // (onlineUsers is a Map of userId -> Set of socketIds)
        this.broadcastOnlineUsers();
      });
    });
  }

  addOnlineSocket(userId, socketId) {
    const sockets = this.onlineUsers.get(userId) || new Set();
    sockets.add(socketId);
    this.onlineUsers.set(userId, sockets);
  }

  removeOnlineSocket(userId, socketId) {
    const sockets = this.onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.onlineUsers.delete(userId);
  }

  getOnlineUserIds() {
    return Array.from(this.onlineUsers.keys());
  }

  broadcastOnlineUsers() {
    if (this.io) {
        this.io.emit('onlineUsers', this.getOnlineUserIds());
    }
  }

  // --- External API ---

  notifyUser(userId, eventName, payload) {
    if (this.io) {
        this.io.to(userId.toString()).emit(eventName, payload);
    }
  }

  notifyAdmins(eventName, payload) {
    if (this.io) {
        this.io.to('admin_channel').emit(eventName, payload);
    }
  }
}

module.exports = new SocketManager();
