const notificationService = require('../services/notificationService');

const notifyAdminsOfApproval = async ({
  targetRole,
  subject,
  emailBody,
  inAppTitle,
  inAppMessage,
  data = {},
  idempotencyKey,
  workflow,
  entityId,
  status,
  actionUrl,
  actionLabel
}, session) => notificationService.notifyAdmins({
  role: targetRole,
  title: inAppTitle || subject,
  message: inAppMessage,
  subject,
  emailBody,
  idempotencyKey,
  workflow,
  entityId,
  status,
  actionUrl,
  actionLabel,
  type: data?.type || 'system',
  data
}, session);

module.exports = {
  notifyAdminsOfApproval
};
