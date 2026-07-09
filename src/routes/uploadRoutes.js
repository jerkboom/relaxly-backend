const express = require('express');

const router = express.Router();

const upload = require('../middleware/uploadMiddleware');

const {
  protect,
} = require('../middleware/authMiddleware');

router.post(
  '/',
  protect,
  upload.array('images', 5),
  (req, res) => {
    const imageUrls = req.files.map(
      (file) => file.path
    );

    res.status(200).json({
      message: 'Images uploaded successfully',
      images: imageUrls,
    });
  }
);

router.post(
  '/public',
  upload.array('images', 1),
  (req, res) => {
    const imageUrls = req.files.map(
      (file) => file.path
    );

    res.status(200).json({
      message: 'ID uploaded successfully',
      images: imageUrls,
    });
  }
);

module.exports = router;