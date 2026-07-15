const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');

const User = require('../models/User');
const University = require('../models/University');
const OwnerInviteCode = require('../models/OwnerInviteCode');
const sendEmail = require('../utils/sendEmail');
const { createNotification } = require('../services/notificationService');

// REGISTER USER
const registerUser = asyncHandler(
  async (req, res) => {
    const {
      name,
      email,
      password,
      gender,
      phone,
      role = 'student',
      accessCode, // Used for owners only
      governmentIdUrl, university, customUniversity, studentId } = req.body;

    // 1. HARD VALIDATION: Required Fields for everyone
    if (!name || !email || !password || !phone) {
      res.status(400);
      throw new Error('Please provide all required fields (name, email, password, phone).');
    }

    // 2. DUPLICATE CHECK: Prevent double registration
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      if (!existingUser.isEmailVerified) {
        const verificationToken = existingUser.generateEmailVerificationToken();
        await existingUser.save();

        const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
        const emailMessage = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #2563eb; padding: 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
            </div>
            <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
              <h2 style="color: #0f172a; margin-top: 0;">Welcome to Relaxly!</h2>
              <p>Please verify your email address to complete your student registration:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Verify Email</a>
              </div>
            </div>
          </div>
        `;

        // Background task
        (async () => {
          try {
            await sendEmail({ email: existingUser.email, subject: 'Verify your Relaxly email', message: emailMessage });
            await createNotification({
              user: existingUser._id,
              title: 'Verify your account',
              message: 'A verification email has been sent to your email address.',
              type: 'account',
            });
          } catch (error) {
            console.error('Background email task failed:', error.message);
          }
        })();

        return res.status(409).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: "This email already has an account. We've sent you a new verification email."
        });
      }

      res.status(400);
      throw new Error('An account already exists for this email.');
    }

    if (phone) {
      const existingPhone = await User.findOne({ phone: phone.trim() });
      if (existingPhone) {
        res.status(400);
        throw new Error('An account already exists with this phone number.');
      }
    }

    // 3. ROLE-SPECIFIC SECURITY VALIDATION
    let userPayload = {
      name,
      email: email.toLowerCase(),
      password,
      gender,
      phone,
      role: role === 'owner' ? 'owner' : 'student',
      agreedToPolicies: true,
      agreedAt: new Date(),
      policyVersion: 'v1.0',
    };

    if (role !== 'owner') {
      if (!university || !studentId) {
        res.status(400);
        throw new Error('Students must provide their University and Student ID Number.');
      }
      
      if (university !== 'other') {
        // VALIDATION: Ensure the university exists in our database
        const uniExists = await University.findById(university);
        if (!uniExists) {
          res.status(400);
          throw new Error('The selected university is invalid or no longer exists. Please refresh and try again.');
        }
        userPayload.university = university;
        userPayload.customUniversity = null;
      } else {
        // VALIDATION: Ensure custom university name is provided
        if (!customUniversity || !customUniversity.trim()) {
          res.status(400);
          throw new Error('Please enter your university name.');
        }
        userPayload.university = null;
        userPayload.customUniversity = customUniversity.trim();
      }
      
      userPayload.studentId = studentId;

      // Optional Campus Ambassador Application details
      if (req.body.applyAsAmbassador === true || req.body.applyAsAmbassador === 'true') {
        userPayload.isAmbassador = true;
        userPayload.ambassadorStatus = 'pending';
        userPayload.ambassadorProfile = {
          university: req.body.ambassadorUniversity || customUniversity || 'Unspecified',
          faculty: req.body.ambassadorFaculty || 'General',
          level: req.body.ambassadorLevel || '100',
          hallHostel: req.body.ambassadorHallHostel || 'Unspecified',
          phone: req.body.ambassadorPhone || phone,
          whatsapp: req.body.ambassadorWhatsapp || phone,
          instagramUsername: req.body.ambassadorInstagram || '',
          tiktokUsername: req.body.ambassadorTiktok || '',
          groupsManagedCount: Number(req.body.ambassadorGroupsCount) || 0,
          estimatedStudentReach: Number(req.body.ambassadorReach) || 0,
          leadershipExperience: req.body.ambassadorExperience || '',
          whyBecomeAmbassador: req.body.ambassadorReason || 'Interested in campus growth',
          studentIdUrl: req.body.ambassadorStudentIdUrl || 'pending',
          profilePictureUrl: req.body.ambassadorProfilePicUrl || 'pending',
          agreedToTerms: req.body.ambassadorAgreed === true || req.body.ambassadorAgreed === 'true',
          badge: 'bronze',
          appliedAt: new Date()
        };
      }
    }

    let inviteRecord = null;

    if (userPayload.role === 'owner') {
      // SECURITY: Owners MUST have a valid invite code and ID
      if (!accessCode || !governmentIdUrl) {
        res.status(400);
        throw new Error('Hostel Owners must provide a valid access code and Government ID.');
      }

      // VALIDATION: Check OwnerInviteCode against assigned email
      inviteRecord = await OwnerInviteCode.findOne({ 
        code: accessCode, 
        assignedToEmail: email.toLowerCase(), 
        isUsed: false 
      });

      if (!inviteRecord) {
        res.status(403);
        throw new Error('Access not granted. Invalid or mismatched access code for this email.');
      }

      // Check expiration
      if (!inviteRecord.neverExpires && inviteRecord.expiresAt && new Date() > inviteRecord.expiresAt) {
        res.status(400);
        throw new Error('This access code has expired.');
      }

      // Owners with valid invite codes are auto-approved and verified
      userPayload.governmentIdUrl = governmentIdUrl;
      userPayload.isEmailVerified = true;
      userPayload.isOwnerVerified = true;
      userPayload.verificationStatus = 'approved';
      userPayload.accountStatus = 'active';
      userPayload.approvedAt = Date.now();
    }

    // 4. EXECUTION: Create user account
    const user = await User.create(userPayload);

    // 4.5. Referral signup tracking
    const referralCode = req.body.refCode || req.body.referralCode;
    if (user.role === 'student' && referralCode) {
      try {
        const ambassadorService = require('../services/ambassadorService');
        await ambassadorService.trackReferralSignup(user._id, referralCode);
      } catch (err) {
        console.error('Referral signup tracking failed:', err.message);
      }
    }

    // 5. SECURITY SEAL: Mark invite code as used
    if (inviteRecord) {
      inviteRecord.isUsed = true;
      inviteRecord.usedBy = user._id;
      await inviteRecord.save();
    }

    // 6. POST-REGISTRATION TASKS
    if (user.role === 'student') {
      // Students need to verify email
      const verificationToken = user.generateEmailVerificationToken();
      await user.save();

      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
      const emailMessage = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #2563eb; padding: 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <h2 style="color: #0f172a; margin-top: 0;">Welcome to Relaxly!</h2>
            <p>Please verify your email address to complete your student registration:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Verify Email</a>
            </div>
          </div>
        </div>
      `;

      // Background task
      (async () => {
        try {
          await sendEmail({ email: user.email, subject: 'Verify your Relaxly email', message: emailMessage });
          await createNotification({
            user: user._id,
            title: 'Verify your account',
            message: 'A verification email has been sent to your email address.',
            type: 'account',
          });
        } catch (error) {
          console.error('Background email task failed:', error.message);
        }
      })();
    } else {
      // Owners get a notification about successful activation
      await createNotification({
        user: user._id,
        title: 'Account Activated',
        message: 'Welcome! Your hostel owner account has been securely activated via invite code.',
        type: 'account',
      });

      // Background task for owner welcome email
      const dashboardUrl = `${process.env.FRONTEND_URL}/login`;
      const ownerEmailMessage = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #2563eb; padding: 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <h2 style="color: #0f172a; margin-top: 0;">Welcome to Relaxly!</h2>
            <p>Your hostel owner account has been securely activated via invite code.</p>
            <p>You can now log in to your dashboard to manage your hostels and bookings.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${dashboardUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Go to Dashboard</a>
            </div>
          </div>
        </div>
      `;

      (async () => {
        try {
          await sendEmail({ email: user.email, subject: 'Welcome to Relaxly - Account Activated', message: ownerEmailMessage });
        } catch (error) {
          console.error('Background owner email task failed:', error.message);
        }
      })();
    }

    res.status(201).json({
      message: user.role === 'owner' 
        ? 'Account created and activated! You can now login.' 
        : 'Account created! Please check your email to verify.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }
);

// LOGIN USER
const loginUser = asyncHandler(
  async (req, res) => {
    const { email, password } =
      req.body;

    // Check required fields
    if (!email || !password) {
      res.status(400);

      throw new Error(
        'Please provide email and password'
      );
    }

    // Check if user exists
    const user =
      await User.findOne({ email });

    if (!user) {
      res.status(400);

      throw new Error(
        'Invalid credentials'
      );
    }

    // CHECK IF VERIFIED
    if (!user.isEmailVerified) {
      return res.status(401).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Your account already exists but your email has not been verified.',
        canResendVerification: true
      });
    }

    // Compare password
    const isMatch =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!isMatch) {
      res.status(400);

      throw new Error(
        'Invalid credentials'
      );
    }

    // Generate JWT Token
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '7d',
      }
    );

    res.status(200).json({
      message: 'Login successful',

      token,

      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }
);

// GET CURRENT USER
const getMe = asyncHandler(
  async (req, res) => {
    const user = await User.findById(
      req.user.id
    ).select('-password');

    res.status(200).json(user);
  }
);

// FORGOT PASSWORD
const forgotPassword = asyncHandler(
  async (req, res) => {
    const { email } = req.body;

    if (!email) {
      res.status(400);

      throw new Error(
        'Please provide an email'
      );
    }

    const user =
      await User.findOne({ email });

    if (!user) {
      res.status(404);

      throw new Error(
        'User not found'
      );
    }

    const resetToken =
      crypto
        .randomBytes(32)
        .toString('hex');

    user.resetPasswordToken =
      crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

    user.resetPasswordExpire =
      Date.now() + 10 * 60 * 1000;

    await user.save({
      validateBeforeSave: false,
    });

    const resetUrl =
      `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #2563eb; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
        </div>
        <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
          <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
          <p>We received a request to reset your password for your Relaxly account.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Reset Password</a>
          </div>
          <p>This link expires in <strong>10 minutes</strong>.</p>
          <p style="font-size: 14px; color: #64748b; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">   
            <strong>Security Notice:</strong> If you did not request this, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
          &copy; 2026 Relaxly. All rights reserved.
        </div>
      </div>
    `;

    try {
      await sendEmail({
        email: user.email,
        subject:
          'Relaxly Password Reset',
        message,
      });

      await createNotification({
        user: user._id,
        title: 'Password reset requested',
        message:
          'A password reset email has been sent to your email address.',
        type: 'account',
      });
    } catch (error) {
      user.resetPasswordToken =
        undefined;

      user.resetPasswordExpire =
        undefined;

      await user.save({
        validateBeforeSave: false,
      });

      res.status(500);

      throw new Error(
        'Email could not be sent'
      );
    }

    res.status(200).json({
      message:
        'Password reset email sent',
    });
  }
);

// RESET PASSWORD
const resetPassword = asyncHandler(
  async (req, res) => {
    const { password } = req.body;

    if (!password) {
      res.status(400);

      throw new Error(
        'Please provide a new password'
      );
    }

    const hashedToken =
      crypto
        .createHash('sha256')
        .update(req.params.token)
        .digest('hex');

    // Find user
    const user = await User.findOne({
      resetPasswordToken:
        hashedToken,

      resetPasswordExpire: {
        $gt: Date.now(),
      },
    });

    if (!user) {
      res.status(400);

      throw new Error(
        'Invalid or expired token'
      );
    }

    user.password =
      password;

    // Clear reset fields
    user.resetPasswordToken =
      undefined;

    user.resetPasswordExpire =
      undefined;

    await user.save();

    res.status(200).json({
      message:
        'Password reset successful',
    });
  }
);

// VERIFY EMAIL
const verifyEmail = asyncHandler(
  async (req, res) => {
    // Hash token
    const hashedToken =
      crypto
        .createHash('sha256')
        .update(req.params.token)
        .digest('hex');

    // Find user
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        code: 'VERIFICATION_TOKEN_INVALID',
        message: 'Invalid verification token.'
      });
    }

    // Check expiration
    if (user.emailVerificationExpires && user.emailVerificationExpires <= Date.now()) {
      return res.status(400).json({
        success: false,
        code: 'VERIFICATION_TOKEN_EXPIRED',
        message: 'Your verification link has expired.',
        email: user.email
      });
    }

    // Verify user
    user.isEmailVerified = true;

    // Clear verification fields
    user.emailVerificationToken =
      undefined;

    user.emailVerificationExpires =
      undefined;

    await user.save();

    await createNotification({
      user: user._id,
      title: 'Account verified',
      message:
        'Your Relaxly account has been verified successfully.',
      type: 'account',
    });

    res.status(200).json({
      message:
        'Email verified successfully',
    });
  }
);


// RESEND VERIFICATION EMAIL
const resendVerificationEmail = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  if (user.isEmailVerified) {
    res.status(400);
    throw new Error('Email is already verified');
  }
  const verificationToken = user.generateEmailVerificationToken();
  await user.save();

  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

  await sendEmail({
    email: user.email,
    subject: 'Verify your Relaxly email',
    message: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #2563eb; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
        </div>
        <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
          <h2 style="color: #0f172a; margin-top: 0;">Verify Your Email Address</h2>
          <p>You requested a new verification email for your Relaxly account. Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Verify Email</a>
          </div>
          <p>This link expires in <strong>24 hours</strong>.</p>
          <p style="font-size: 14px; color: #64748b; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">   
            If the button above doesn't work, copy and paste this link into your browser:<br>
            <a href="${verificationUrl}" style="color: #2563eb;">${verificationUrl}</a>
          </p>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
          &copy; 2026 Relaxly. All rights reserved.
        </div>
      </div>
    `
  });

  res.status(200).json({
    success: true,
    message: 'Verification email resent successfully'
  });
});

module.exports = {
  resendVerificationEmail,
  registerUser,
  loginUser,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
};
