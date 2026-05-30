const express = require('express');
const router = express.Router();
const {
  updateCommission,
  togglePayoutFreeze,
  suspendOwner,
  unsuspendOwner,
  deleteOwner
} = require('../controllers/ownerGovernanceController');
const { protect } = require('../middleware/authMiddleware');
const authorizeAdminRoles = require('../middleware/adminPermissionMiddleware');

// PROTECT ALL ROUTES
router.use(protect);

// Only Super Admins and Finance Admins can perform these actions
router.use(authorizeAdminRoles('super_admin', 'finance_admin'));

router.patch('/:id/commission', updateCommission);
router.patch('/:id/payout-freeze', togglePayoutFreeze);
router.patch('/:id/suspend', suspendOwner);
router.patch('/:id/unsuspend', unsuspendOwner);
router.delete('/:id', deleteOwner);

module.exports = router;
