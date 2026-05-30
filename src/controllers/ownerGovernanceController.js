const asyncHandler = require('express-async-handler');
const ownerGovernanceService = require('../services/ownerGovernanceService');
const { sendSuccess } = require('../utils/responseHandler');

// @desc    Update custom commission rate for an owner
// @route   PATCH /api/admin/owners/:id/commission
const updateCommission = asyncHandler(async (req, res) => {
  const { customCommissionRate } = req.body;
  const owner = await ownerGovernanceService.updateCommission(req.params.id, customCommissionRate, req);
  sendSuccess(res, owner, 'Commission rate updated successfully');
});

// @desc    Toggle payout freeze for an owner
// @route   PATCH /api/admin/owners/:id/payout-freeze
const togglePayoutFreeze = asyncHandler(async (req, res) => {
  const { frozen, reason } = req.body;
  const owner = await ownerGovernanceService.togglePayoutFreeze(req.params.id, frozen, reason, req);
  sendSuccess(res, owner, `Payouts ${frozen ? 'frozen' : 'unfrozen'} successfully`);
});

// @desc    Suspend an owner account
// @route   PATCH /api/admin/owners/:id/suspend
const suspendOwner = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const owner = await ownerGovernanceService.suspendOwner(req.params.id, reason, req);
  sendSuccess(res, owner, 'Owner account suspended successfully');
});

// @desc    Unsuspend an owner account
// @route   PATCH /api/admin/owners/:id/unsuspend
const unsuspendOwner = asyncHandler(async (req, res) => {
  const owner = await ownerGovernanceService.unsuspendOwner(req.params.id, req);
  sendSuccess(res, owner, 'Owner account unsuspended successfully');
});

// @desc    Safely delete an owner account
// @route   DELETE /api/admin/owners/:id
const deleteOwner = asyncHandler(async (req, res) => {
  const result = await ownerGovernanceService.deleteOwner(req.params.id, req);
  sendSuccess(res, result.data, result.message);
});

module.exports = {
  updateCommission,
  togglePayoutFreeze,
  suspendOwner,
  unsuspendOwner,
  deleteOwner
};
