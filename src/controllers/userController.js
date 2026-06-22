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


// TOGGLE WISHLIST
const toggleWishlist = asyncHandler(async (req, res) => {
  const { hostelId } = req.params;
  const mongoose = require('mongoose');

  if (!mongoose.Types.ObjectId.isValid(hostelId)) {
    res.status(400);
    throw new Error('Invalid hostel ID');
  }

  const user = await User.findById(req.user._id);
  const Hostel = require('../models/Hostel');

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const isSaved = user.wishlist.some(id => id.toString() === hostelId);
  
  if (isSaved) {
    // Remove
    user.wishlist = user.wishlist.filter(id => id.toString() !== hostelId);
    
    // Decrement but ensure it doesn't go below 0
    const hostel = await Hostel.findById(hostelId);
    if (hostel) {
      hostel.timesSaved = Math.max(0, (hostel.timesSaved || 0) - 1);
      await hostel.save();
    }
  } else {
    // Add
    user.wishlist.push(hostelId);
    await Hostel.findByIdAndUpdate(hostelId, { $inc: { timesSaved: 1 } });
  }

  await user.save();
  sendSuccess(res, { isSaved: !isSaved }, isSaved ? 'Removed from wishlist' : 'Added to wishlist');
});

// GET WISHLIST
const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'wishlist',
    populate: { path: 'university', select: 'name' }
  });

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Filter out null entries due to deleted hostels
  const originalLength = user.wishlist.length;
  const filteredWishlist = user.wishlist.filter(item => item !== null);

  // If some hostels were deleted, update the user document in the DB to clean up stale references
  if (filteredWishlist.length < originalLength) {
    user.wishlist = filteredWishlist.map(item => item._id);
    await user.save();
  }

  sendSuccess(res, filteredWishlist, 'Wishlist retrieved successfully');
});

module.exports = {
  getUserById,
  getProfile,
  updateProfile,
  verifyInviteCode,
  toggleWishlist,
  getWishlist,
};


