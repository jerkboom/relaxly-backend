const { sendError } = require('../utils/responseHandler');

const normalizeRole = (role = "") => String(role).toLowerCase().trim();

/**
 * Middleware to protect sensitive finance operations.
 * Requires the user to explicitly be a SUPER_ADMIN.
 */
const financeGuard = (req, res, next) => {
  const user = req.admin || req.user;

  if (!user) {
    return sendError(res, 'Not authorized. Finance session missing.', 401);
  }

  const userRole = normalizeRole(user.role);

  // If it's a mutation (POST, PUT, PATCH, DELETE)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (userRole !== 'super_admin' && userRole !== 'admin') {
      return sendError(res, 'Sensitive financial operations require SUPER_ADMIN privileges.', 403);
    }
  }

  next();
};

module.exports = financeGuard;
