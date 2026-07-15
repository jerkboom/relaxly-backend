const AdminAuditLog = require('../models/AdminAuditLog');
const socketManager = require('./socketManager');

const getActor = (req) => req?.admin || req?.user || null;

const logAdminAction = async ({
  req,
  actionType,
  targetType,
  targetId,
  severity = 'low',
  status = 'success',
  metadata = {},
}, session) => {
  try {
    const actor = getActor(req);
    const isProvisionedAdmin = Boolean(req?.admin || actor?.status);

    const logData = {
      admin: actor?._id || actor?.id || null,
      adminModel: isProvisionedAdmin ? 'Admin' : 'User',
      actionType,
      targetType,
      targetId,
      severity,
      status,
      metadata,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent'],
    };

    let log;
    if (session) {
      const [newLog] = await AdminAuditLog.create([logData], { session });
      log = newLog;
    } else {
      log = await AdminAuditLog.create(logData);
    }

    socketManager.notifyAdmins('audit_event', {
      ...log.toObject(),
      admin: actor
        ? { name: actor.name, email: actor.email }
        : { name: 'System' },
    });
  } catch (error) {
    console.error('FAILED TO LOG ADMIN ACTION:', error.message);
  }
};

module.exports = {
  logAdminAction,
};
