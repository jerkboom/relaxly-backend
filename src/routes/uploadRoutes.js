const express = require('express');
const router = express.Router();
const { upload, uploadToCloudinary } = require('../middleware/uploadMiddleware');
const { protect } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

// Generic helper to handle uploads dynamically
const handleFileUploads = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new Error('No file uploaded or field name mismatch. Please use "file" or "images" fields.');
  }

  const imageUrls = [];

  for (const file of req.files) {
    if (file.buffer) {
      // Cloudinary mode (memory storage)
      logger.info(`Uploading file ${file.originalname} to Cloudinary...`);
      const result = await uploadToCloudinary(file.buffer, file.originalname, 'relaxly_uploads');
      imageUrls.push(result.secure_url || result.url);
    } else if (file.path) {
      // Local disk mode
      // Convert filesystem absolute path to web path /uploads/filename.ext
      const webPath = `/uploads/${file.filename}`;
      imageUrls.push(webPath);
    } else {
      throw new Error('File storage type not recognized (no buffer or path found)');
    }
  }

  return imageUrls;
};

// Route: POST /api/upload (Protected, multiple images)
router.post(
  '/',
  protect,
  upload.any(),
  async (req, res) => {
    try {
      const imageUrls = await handleFileUploads(req, res);
      res.status(200).json({
        message: 'Images uploaded successfully',
        images: imageUrls,
        fileUrl: imageUrls[0] // fallback for single file consumers
      });
    } catch (error) {
      logger.error('Failed to process upload:', error);
      res.status(500).json({
        message: 'Failed to upload assets.',
        error: error.message
      });
    }
  }
);

// Route: POST /api/upload/public (Public, single or multiple files e.g. student ID, profile picture)
router.post(
  '/public',
  upload.any(),
  async (req, res) => {
    try {
      const imageUrls = await handleFileUploads(req, res);
      res.status(200).json({
        message: 'File uploaded successfully',
        images: imageUrls,
        fileUrl: imageUrls[0] // fallback for single file consumers
      });
    } catch (error) {
      logger.error('Failed to process public upload:', error);
      res.status(500).json({
        message: 'Failed to upload asset.',
        error: error.message
      });
    }
  }
);

module.exports = router;