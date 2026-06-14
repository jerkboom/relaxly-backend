const asyncHandler = require('express-async-handler');
const studentService = require('../../services/studentService');
const { sendSuccess } = require('../../utils/responseHandler');

/**
 * @desc    Get complete student profile with bookings, payments, refunds and timeline
 * @route   GET /api/admin/students/:id/full-profile
 * @access  Private/Admin
 */
const getStudentFullProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const profileData = await studentService.getStudentFullProfile(id);
  sendSuccess(res, profileData);
});

module.exports = {
  getStudentFullProfile
};
