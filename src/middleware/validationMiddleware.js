const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

/**
 * Handle validation results from express-validator chains.
 * Standardized to return { success: false, message: "..." }
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // Join all validation error messages into a single string for the standardized response
    const message = errors.array().map(err => err.msg).join(', ');
    
    return res.status(400).json({
      success: false,
      message
    });
  }

  next();
};

/**
 * Middleware to validate MongoDB ObjectIds in request parameters or body
 * @param {string[]} fields - Array of field names to validate
 * @param {string} source - 'params' or 'body' (default: 'params')
 */
const validateObjectIds = (fields, source = 'params') => {
  return (req, res, next) => {
    const data = req[source];
    
    for (const field of fields) {
      let id = data[field];
      
      // Handle case where id might be an object (e.g., populated from frontend)
      if (id && typeof id === 'object' && id._id) {
        id = id._id;
      }

      if (id && !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: `Invalid ID provided for ${field}: ${id}`
        });
      }
    }
    
    next();
  };
};

module.exports = {
  validate,
  validateObjectIds
};
