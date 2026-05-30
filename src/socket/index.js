const { Server } = require("socket.io");
const socketManager = require("../utils/socketManager");

let io;

const initIO = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001"
      ],
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
