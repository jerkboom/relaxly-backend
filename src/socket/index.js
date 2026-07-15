const { Server } = require("socket.io");
const socketManager = require("../utils/socketManager");

let io;

const getAllowedOrigins = () => [
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  process.env.ADMIN_URL
].filter(Boolean);

const initIO = (server) => {
  io = new Server(server, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Initialize existing socket manager for auth and online tracking
  socketManager.init(io);

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join", (userId) => {
      socket.join(userId.toString());
      console.log(`User ${userId} joined their personal room`);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};

module.exports = {
  initIO,
  getIO
};
