const asyncHandler = require('express-async-handler');
const Message = require('../models/Message');
const User = require('../models/User');
const { getIO } = require('../socket');

// @desc    Get direct messages with a specific user
// @route   GET /api/messages/:userId
// @access  Private
const getMessages = asyncHandler(async (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = req.params.userId;

  const messages = await Message.find({
    $or: [
      { sender: currentUserId, recipient: otherUserId },
      { sender: otherUserId, recipient: currentUserId }
    ]
  }).sort({ createdAt: 1 }).populate('sender', 'name email role avatar').populate('recipient', 'name email role avatar');

  // Mark as read
  await Message.updateMany(
    { sender: otherUserId, recipient: currentUserId, status: { $ne: 'read' } },
    { status: 'read', readAt: new Date() }
  );

  res.status(200).json(messages);
});

// @desc    Send a new message
// @route   POST /api/messages
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const senderId = req.user.id;
  const { recipient, content, channel } = req.body;

  if (!recipient || !content) {
    res.status(400);
    throw new Error('Recipient and content are required');
  }

  const message = await Message.create({
    sender: senderId,
    recipient,
    content,
    channel: channel || 'app',
    status: 'sent'
  });

  const populatedMessage = await Message.findById(message._id)
    .populate('sender', 'name email role avatar')
    .populate('recipient', 'name email role avatar');

  const io = getIO();
  if (io) {
    io.to(recipient.toString()).emit('new_message', populatedMessage);
    io.to(senderId.toString()).emit('message_sent', populatedMessage);
  }

  res.status(201).json(populatedMessage);
});

// @desc    Get all direct message threads for current user
// @route   GET /api/messages/threads
// @access  Private
const getThreads = asyncHandler(async (req, res) => {
  const currentUserId = req.user.id;
  
  // Basic implementation: get all messages, group by other user
  const messages = await Message.find({
    $or: [{ sender: currentUserId }, { recipient: currentUserId }]
  }).sort({ createdAt: -1 }).populate('sender', 'name email role avatar').populate('recipient', 'name email role avatar');

  const threadsMap = new Map();

  messages.forEach(msg => {
    const otherUser = msg.sender._id.toString() === currentUserId ? msg.recipient : msg.sender;
    const otherUserIdStr = otherUser._id.toString();

    if (!threadsMap.has(otherUserIdStr)) {
      threadsMap.set(otherUserIdStr, {
        user: otherUser,
        lastMessage: msg,
        unreadCount: (msg.recipient._id.toString() === currentUserId && msg.status !== 'read') ? 1 : 0
      });
    } else {
      if (msg.recipient._id.toString() === currentUserId && msg.status !== 'read') {
        const thread = threadsMap.get(otherUserIdStr);
        thread.unreadCount += 1;
      }
    }
  });

  const threads = Array.from(threadsMap.values());

  res.status(200).json(threads);
});

module.exports = {
  getMessages,
  sendMessage,
  getThreads
};
