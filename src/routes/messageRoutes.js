const express = require('express');
const router = express.Router();
const { getMessages, sendMessage, getThreads } = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/').post(sendMessage);
router.route('/threads').get(getThreads);
router.route('/:userId').get(getMessages);

module.exports = router;
