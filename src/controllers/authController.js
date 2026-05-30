const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const asyncHandler = require(
  'express-async-handler'
);

const User = require('../models/User');

const sendEmail = require(
  '../utils/sendEmail'
);

const {
  createNotification,
} = require('../services/notificationService');

// REGISTER USER
const registerUser = asyncHandler(
  async (req, res) => {
    const {
      name,
      email,
      password,
      gender,
      role = 'student',
    } = req.body;

    // Check required fields
    if (
      !name ||
      !email ||
      !password
    ) {
      res.status(400);

      throw new Error(
        'Please provide all fields'
      );
    }

    // Check if user already exists
    const existingUser =
      await User.findOne({ email });

    if (existingUser) {
      res.status(400);

      throw new Error(
        'User already exists'
      );
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      gender,
      role: ['student', 'owner'].includes(role)
        ? role
        : 'student',
    });

    // Generate verification token
    const verificationToken =
      user.generateEmailVerificationToken();

    await user.save();

    // 1. Return the API response immediately after user creation and token generation
    res.status(201).json({
      message:
        'User registered successfully. Please verify your email.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
    });

    // 2. Move email sending to a non-blocking async task
    // 3. Add proper try/catch around email sending
    // 4. Ensure registration never hangs if email fails
    const verificationUrl =
      `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #2563eb; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Relaxly</h1>
        </div>
        <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
          <h2 style="color: #0f172a; margin-top: 0;">Welcome to Relaxly!</h2>
          <p>Thank you for joining Relaxly. We're excited to help you find your perfect student accommodation.</p>
          <p>Please verify your email address to get started:</p>
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
    `;

    // Background tasks - Fire and forget with internal error handling
    (async () => {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Verify your Relaxly email',
          message,
        });

        await createNotification({
          user: user._id,
          title: 'Verify your account',
          message: 'A verification email has been sent to your email address.',
          type: 'account',
        });
      } catch (error) {
        // Logging the error instead of throwing prevents the request from hanging
        console.error('Registration background task failed:', error.message);
      }
    })();
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
      res.status(401);

      throw new Error(
        'Please verify your email first'
      );
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
      emailVerificationToken:
        hashedToken,

      emailVerificationExpires: {
        $gt: Date.now(),
      },
    });

    if (!user) {
      res.status(400);

      throw new Error(
        'Invalid or expired verification token'
      );
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
