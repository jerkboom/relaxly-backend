const OwnerActivityLog = require('../models/OwnerActivityLog');

/**
 * Logs an important owner action for the forensic audit trail.
 * @param {Object} params
 * @param {string} params.ownerId - The ID of the owner performing the action.
 * @param {string} [params.actorId] - The ID of the actor (Owner/Admin).
 * @param {string} [params.actorName] - The name of the actor.
 * @param {string} [params.actorRole] - The role of the actor.
 * @param {string} params.eventType - Categorical type of the event (e.g., 'hostel', 'room', 'booking').
 * @param {string} params.title - Human-readable title of the event.
 * @param {string} params.description - Detailed description of the event.
 * @param {Object} [params.metadata] - Additional context-specific data.
 */
const logOwnerActivity = async ({ 
  ownerId, 
  actorId, 
  actorName, 
  actorRole, 
  eventType, 
  title, 
  description, 
  metadata = {} 
}) => {
  try {
    await OwnerActivityLog.create({
      ownerId,
      actorId,
      actorName: actorName || 'System',
      actorRole,
      eventType,
      title,
      description,
      metadata,
    });
  } catch (error) {
    console.error('[OWNER_ACTIVITY_LOG_ERROR]', error.message);
  }
};

module.exports = {
  logOwnerActivity,
};
