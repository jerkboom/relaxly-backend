const asyncHandler = require('express-async-handler');

// CHECK IF EMAIL IS VERIFIED
const isEmailVerified = asyncHandler(async (req, res, next) => {
  if (!req.user.isEmailVerified) {
    res.status(403);
    throw new Error('Please verify your email to access this feature.');
  }
  next();
});

// CHECK IF OWNER IS VERIFIED AND APPROVED
const isOwnerApproved = asyncHandler(async (req, res, next) => {
  if (req.user.role === 'owner') {
    // Allow access if verificationStatus is 'verified' (auto-granted upon email verification) 
    // or 'approved' (legacy/manual admin approval).
    const isVerified = req.user.verificationStatus === 'verified';
    const isApproved = req.user.verificationStatus === 'approved';
    const hasOwnerFlag = req.user.isOwnerVerified === true;

    if (!hasOwnerFlag || (!isVerified && !isApproved)) {
      res.status(403);
      throw new Error('Owner access restricted. Please complete your verification and wait for admin approval.');
    }
  }
  next();
});

module.exports = {
  isEmailVerified,
  isOwnerApproved,
};
