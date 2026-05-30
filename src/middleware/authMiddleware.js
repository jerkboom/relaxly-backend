const jwt =
  require('jsonwebtoken');

const User =
  require('../models/User');

const Admin =
  require('../models/Admin');

const normalizeRole = (role) => {
  if (!role) return 'student';
  const r = String(role).toLowerCase();
  if (r === 'admin') return 'super_admin';
  return r;
};

// PROTECT ROUTES
const protect = async (
  req,
  res,
  next
) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith(
      'Bearer'
    )
  ) {
    try {
      token =
        req.headers.authorization.split(
          ' '
        )[1];

      // VERIFY TOKEN
      const decoded =
        jwt.verify(
          token,
          process.env.JWT_SECRET
        );

      // GET FULL AUTHENTICATED ACCOUNT FROM DATABASE
      if (decoded.authType === 'admin') {
        req.user = await Admin.findById(decoded.id).select('-password');
        req.admin = req.user;
      } else {
        // FETCH FRESH USER STATE FROM DB
        req.user = await User.findById(decoded.id).select('-password');

        // Backward-compatible fallback for admin tokens issued before authType existed.
        if (!req.user) {
          req.user = await Admin.findById(decoded.id).select('-password');
          req.admin = req.user;
        }
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message:
            'Not authorized, account no longer exists',
        });
      }

      if (!req.user.accountStatus && req.user.status) {
        req.user.accountStatus = req.user.status;
      }

      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message:
          'Not authorized, token failed',
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message:
        'Not authorized, no token',
    });
  }
};

// ROLE AUTHORIZATION
const authorizeRoles =
  (...roles) => {
    const authorizedRoles = roles.map(r => String(r).toLowerCase());
    return (
      req,
      res,
      next
    ) => {
      const userRole = (req.user.role || 'student').toLowerCase();
      if (
        !authorizedRoles.includes(userRole) &&
        !authorizedRoles.includes(normalizeRole(userRole))
      ) {
        return res.status(403).json(
          {
            success: false,
            message: `Role (${req.user.role}) is not allowed`,
          }
        );
      }

      next();
    };
  };

module.exports = {
  protect,
  authorizeRoles,
};
