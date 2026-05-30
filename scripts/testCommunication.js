const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Campaign = require('../src/models/Campaign');
const MessageTemplate = require('../src/models/MessageTemplate');
const CommunicationQueue = require('../src/models/CommunicationQueue');
const DeliveryLog = require('../src/models/DeliveryLog');
const EmailLog = require('../src/models/EmailLog');
const SmsLog = require('../src/models/SmsLog');
const notificationService = require('../src/services/notificationService');
const { processQueue } = require('../src/workers/communicationWorker');

const runTest = async () => {
  await connectDB();
  console.log('Connected to DB');

  // Create a mock user
  let user = await User.findOne({ email: 'testcomm@example.com' });
  if (!user) {
    user = await User.create({
      name: 'Test Comm User',
      email: 'testcomm@example.com',
      phone: '+1234567890',
      password: 'password123',
      role: 'student'
    });
  }

  // Create a template
  const template = await MessageTemplate.create({
    name: 'Test Template ' + Date.now(),
    title: 'Hello {{name}}',
    body: 'This is a test message to {{email}}.',
    channels: ['dashboard', 'email', 'sms'],
    createdBy: user._id
  });

  console.log('Created Template');

  // Create a Campaign
  const campaign = await Campaign.create({
    name: 'Test Campaign ' + Date.now(),
    template: template._id,
    audience: { type: 'specific_users', filters: { specificUserIds: [user._id] } },
    channels: ['dashboard', 'email', 'sms'],
    priority: 'important',
    createdBy: user._id
  });

  console.log('Created Campaign');

  // Execute campaign -> Should queue items
  await notificationService.executeCampaign(campaign._id);
  console.log('Executed campaign. Queuing items...');

  const queuedItems = await CommunicationQueue.find({ campaign: campaign._id });
  console.log(`Queued items count: ${queuedItems.length}`);
  if (queuedItems.length !== 3) {
    console.error('Expected 3 queued items (dashboard, email, sms).');
  }

  // Process the queue
  console.log('Processing queue manually...');
  await processQueue();

  // Check logs
  const deliveryLogs = await DeliveryLog.find({ campaign: campaign._id });
  console.log(`Delivery logs count: ${deliveryLogs.length}`);

  const emailLogs = await EmailLog.find({ campaign: campaign._id });
  console.log(`Email logs count: ${emailLogs.length}`);

  const smsLogs = await SmsLog.find({ campaign: campaign._id });
  console.log(`SMS logs count: ${smsLogs.length}`);

  console.log('Test completed successfully.');
  process.exit(0);
};

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});