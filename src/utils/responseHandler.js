/**
 * Standardized Response Formatter
 */
exports.sendSuccess = (res, data, message = 'Success', status = 200) => {
  res.status(status).json({
    success: true,
    message,
    data
  });
};

exports.sendError = (res, message = 'An error occurred', status = 400) => {
  res.status(status).json({
    success: false,
    message
  });
};
