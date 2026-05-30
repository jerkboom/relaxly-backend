const express = require('express');
const router = express.Router();
const {
  getOwnerOverview,
  getOwnerHostels,
  getOwnerRooms,
  getOwnerBookings,
  getOwnerTransactions,
  getOwnerPayouts,
  getOwnerAnalytics,
  getOwnerActivityTimeline,
  getOwnerAuditReport
} = require('../controllers/ownerOperationsController');

const {
  updateCommission,
  togglePayoutFreeze,
  suspendOwner,
  unsuspendOwner,
  deleteOwner
} = require('../controllers/ownerGovernanceController');

const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// PROTECT ALL ROUTES - Admin Only
router.use(protect);

// READ OPERATIONS: Allowed for Super Admin, Finance Admin, Moderator
router.get('/:id/overview', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerOverview);
router.get('/:id/hostels', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerHostels);
router.get('/:id/rooms', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerRooms);
router.get('/:id/bookings', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerBookings);
router.get('/:id/transactions', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerTransactions);
router.get('/:id/payouts', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerPayouts);
router.get('/:id/analytics', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerAnalytics);
router.get('/:id/timeline', authorizeAdminRoles('super_admin', 'finance_admin', 'moderator'), getOwnerActivityTimeline);
router.get('/:id/audit-report', authorizeAdminRoles('super_admin', 'finance_admin'), getOwnerAuditReport);

// GOVERNANCE OPERATIONS: Strictly Super Admin & Finance Admin
router.patch('/:id/commission', authorizeAdminRoles('super_admin', 'finance_admin'), updateCommission);
router.patch('/:id/payout-freeze', authorizeAdminRoles('super_admin', 'finance_admin'), togglePayoutFreeze);
router.patch('/:id/suspend', authorizeAdminRoles('super_admin', 'finance_admin'), suspendOwner);
router.patch('/:id/unsuspend', authorizeAdminRoles('super_admin', 'finance_admin'), unsuspendOwner);
router.delete('/:id', authorizeAdminRoles('super_admin', 'finance_admin'), deleteOwner);

module.exports = router;
