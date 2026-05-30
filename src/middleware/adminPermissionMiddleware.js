const { sendError } = require('../utils/responseHandler');

const normalizeRole = (role = "") => String(role).toLowerCase().trim();

/**
 * Middleware to ensure the user has one of the specified admin roles.
 * Also checks if the account is active.
 */
const authorizeAdminRoles = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles.map(r => normalizeRole(r));
  
  return (req, res, next) => {
    // 1. Check if user exists (set by previous auth middleware)
    const adminAccount = req.admin || req.user;

    if (!adminAccount) {
      return sendError(res, 'Not authorized. Session missing or expired.', 401);
    }

    const userAccountStatus = normalizeRole(adminAccount.accountStatus || adminAccount.status || '');
    const userRole = normalizeRole(adminAccount.role || '');

    // 2. Check if account is active
    if (userAccountStatus && userAccountStatus !== 'active') {
      return sendError(res, `Admin account is not active (${userAccountStatus}). Access denied.`, 403);
    }

    // 3. Check role
    const allowedRoleSet = new Set(normalizedAllowedRoles);

    // Support both 'admin' as legacy super_admin and explicit roles
    const isLegacySuperAdmin = userRole === 'admin' && allowedRoleSet.has('super_admin');

    if (!allowedRoleSet.has(userRole) && !isLegacySuperAdmin) {
      return sendError(res, `Permission denied. Role (${userRole}) is not authorized for this operation.`, 403);
    }

    next();
  };
};

module.exports = authorizeAdminRoles;
