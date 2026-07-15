const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('../config/cloudinary');

// Use memory storage for Cloudinary stream upload
const memoryStorage = multer.memoryStorage();

// Disk storage fallback for local development
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure multer
const upload = multer({
  storage: process.env.CLOUDINARY_CLOUD_NAME ? memoryStorage : diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const uploadToCloudinary = (fileBuffer, originalName, folder = 'relaxly_marketing') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: path.parse(originalName).name.replace(/\s+/g, '_') + '_' + Date.now(),
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

module.exports = {
  upload,
  uploadToCloudinary
};