const University = require('../models/University');
const cache = require('../utils/cache');
const { invalidateUniversityLookupCaches } = require('../utils/hostelCache');

// CREATE UNIVERSITY
const createUniversity = async (req, res) => {
  try {
    const { name, location, region, description, image } = req.body;

    const university = await University.create({
      name,
      location,
      region,
      description,
      image,
    });

    invalidateUniversityLookupCaches();

    res.status(201).json({
      message: 'University created successfully',
      university,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// GET ALL UNIVERSITIES
const getUniversities = async (req, res) => {
  try {
    const cacheKey = 'universities';
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const universities = await University.find();

    // CACHE DATA
    cache.set(cacheKey, universities, 86400); // 24 hours

    res.status(200).json(universities);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createUniversity,
  getUniversities,
};
