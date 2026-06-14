const asyncHandler =
  require('express-async-handler');

const User =
  require('../models/User');

const inviteCodeService = require('../services/inviteCodeService');
const { sendSuccess } = require('../utils/responseHandler');

// GET PROFILE
const getProfile =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(req.user._id).populate(
          'university',
          'name'
        );

      if (!user) {
        res.status(404);

        throw new Error(
          'User not found'
        );
      }

      sendSuccess(res, user, 'Profile fetched successfully');
    }
  );

// UPDATE PROFILE
const updateProfile =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(req.user._id);

      if (!user) {
        res.status(404);

        throw new Error(
          'User not found'
        );
      }

      user.name =
        req.body.name ||
        user.name;

      user.phone =
        req.body.phone ||
        user.phone;

      user.gender =
        req.body.gender ||
        user.gender;

      user.bio =
        req.body.bio ||
        user.bio;

      user.profileImage =
        req.body.profileImage ||
        user.profileImage;

      // Update new fields
      if (user.role === 'student') {
        user.schoolName = req.body.schoolName || user.schoolName;
        user.studentId = req.body.studentId || user.studentId;
        user.university = req.body.university || user.university;
        user.customUniversity = req.body.customUniversity !== undefined ? req.body.customUniversity : user.customUniversity;
      }

      if (user.role === 'owner') {
        user.governmentIdUrl = req.body.governmentIdUrl || user.governmentIdUrl;
        // user.ownerAccessCode = req.body.ownerAccessCode || user.ownerAccessCode; // Moved to verifyInviteCode
      }

      const updatedUser =
        await user.save();

      sendSuccess(res, updatedUser, 'Profile updated successfully');
    }
  );

// VERIFY INVITE CODE
const verifyInviteCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    res.status(400);
    throw new Error('Please provide an invite code');
  }

  const user = await User.findById(req.user._id);
  if (!user || user.role !== 'owner') {
    res.status(403);
    throw new Error('Only owners can verify invite codes');
  }

  await inviteCodeService.validateAndUseCode(code, user);
  sendSuccess(res, { isOwnerVerified: true }, 'Invite code verified successfully. Your dashboard is now unlocked.');
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(
    'name email phone role profileImage bio createdAt'
  );

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  sendSuccess(res, user, 'Profile fetched successfully');
});

module.exports = {
  getUserById,
  getProfile,
  updateProfile,
  verifyInviteCode,
};


