const logger = require('../utils/logger');
const { sendError } = require('../utils/responseHandler');

const errorHandler = (err, req, res, next) => {
  // 1. Determine the status code - PRIORITIZE err.statusCode
  const statusCode = err.statusCode || err.status || (res.statusCode === 200 ? 500 : res.statusCode);

  // 2. Log the full error internally using Winston
  logger.error(`${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
    stack: err.stack,
    body: req.body,
    user: req.user ? req.user.id : 'unauthenticated'
  });

  // 3. Format the user-facing message
  // If it's a 500 error in production, hide the details from the user!
  let message = err.message;
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'An unexpected internal server error occurred.';
  }

  // 4. Send the safe response
  return sendError(res, message, statusCode);
};

// 404 Catch-all for undefined routes
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

module.exports = { errorHandler, notFoundHandler };
