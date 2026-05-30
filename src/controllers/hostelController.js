const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const pickHostelFields = (body) => {
  const allowedFields = [
    'name', 'description', 'location', 'price', 'pricingType', 'images', 'featuredImage',
    'amenities', 'rules', 'policies', 'university', 'nearbyUniversities', 'available',
    'wifi', 'ac', 'security', 'water', 'electricity', 'totalRooms', 'availableRooms', 'genderAllowed',
  ];
  const update = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      update[field] = body[field];
    }
  });
  return update;
};

// CREATE HOSTEL
const createHostel = asyncHandler(async (req, res) => {
  const data = pickHostelFields(req.body);
  const hostel = await Hostel.create({
    ...data,
    owner: req.user.id,
  });
  sendSuccess(res, hostel, 'Hostel created successfully', 201);
});

// GET ALL HOSTELS WITH SEARCH, FILTERING, SORTING & PAGINATION
const getHostels = asyncHandler(async (req, res) => {
  console.log('HOSTEL QUERY PARAMS:', req.query);

  const {
    search,
    location,
    university,
    minPrice,
    maxPrice,
    amenities,
    roomTypes,
    gender,
    verified,
    availableNow,
    sort,
    page = 1,
    limit = 12, // Default to 12 for grid
  } = req.query;

  // FILTER OBJECT - Start with public-safe defaults
  let filter = {
    verificationStatus: 'approved',
    available: true,
  };

  const isInvalid = (val) => !val || val === 'undefined' || val === 'null' || val === 'all' || val === '';

  // Use an array to collect complex conditions that will be combined with $and
  const conditions = [];

  // 1. General Search Filter (name, location, description, nearbyUniversities)
  if (!isInvalid(search)) {
    const searchRegex = { $regex: String(search), $options: 'i' };
    conditions.push({
      $or: [
        { name: searchRegex },
        { location: searchRegex },
        { description: searchRegex },
        { nearbyUniversities: searchRegex }
      ]
    });
  }

  // 2. Location filter
  if (!isInvalid(location)) {
    const locationRegex = { $regex: String(location), $options: 'i' };
    conditions.push({
      $or: [
        { location: locationRegex },
        { name: locationRegex } // Fallback to name if location is used as a general search
      ]
    });
  }

  // 3. University filter
  if (!isInvalid(university)) {
    const isObjectId = mongoose.Types.ObjectId.isValid(university);
    if (isObjectId) {
      conditions.push({
        $or: [
          { university: university },
          { nearbyUniversities: { $regex: String(university), $options: 'i' } },
        ]
      });
    } else {
      const universityRegex = { $regex: String(university), $options: 'i' };
      conditions.push({
        $or: [
          { nearbyUniversities: universityRegex },
          { name: universityRegex }
        ]
      });
    }
  }

  // Combine conditions into the main filter using $and
  if (conditions.length > 0) {
    filter.$and = conditions;
  }

  // Price filter
  if (!isInvalid(minPrice) || !isInvalid(maxPrice)) {
    filter.price = {};
    if (!isInvalid(minPrice)) filter.price.$gte = Number(minPrice);
    if (!isInvalid(maxPrice)) filter.price.$lte = Number(maxPrice);
  }

  // Gender filter
  if (!isInvalid(gender) && gender !== 'Mixed') {
    filter.genderAllowed = gender;
  }

  // Verified filter
  if (verified === 'true') {
    filter.isVerified = true;
  }

  // Available now
  if (availableNow === 'true') {
    filter.availableRooms = { $gt: 0 };
  }

  // Amenities filter
  if (!isInvalid(amenities)) {
    const amenitiesArray = Array.isArray(amenities) ? amenities : String(amenities).split(',').map(a => a.trim());
    const validAmenities = amenitiesArray.filter(a => a !== '');
    
    if (validAmenities.length > 0) {
      const orConditions = [];
      validAmenities.forEach(a => {
        const lower = a.toLowerCase();
        if (lower === 'wifi') orConditions.push({ wifi: true });
        else if (lower === 'ac' || lower === 'air conditioning') orConditions.push({ ac: true });
        else if (lower === 'security') orConditions.push({ security: true });
        else orConditions.push({ amenities: { $in: [a] } });
      });

      if (orConditions.length > 0) {
        if (!filter.$and) filter.$and = [];
        filter.$and.push({ $or: orConditions });
      }
    }
  }

  // Room Types filter
  if (!isInvalid(roomTypes)) {
    const roomTypesArray = Array.isArray(roomTypes) ? roomTypes : String(roomTypes).split(',').map(t => t.trim());
    const validTypes = roomTypesArray.filter(t => t !== '');

    if (validTypes.length > 0) {
      const hostelsWithRoomTypes = await Room.distinct('hostel', {
        occupancyStyle: { $in: validTypes },
        roomStatus: 'available',
        availableBeds: { $gt: 0 }
      });
      
      if (!filter.$and) filter.$and = [];
      filter.$and.push({ _id: { $in: hostelsWithRoomTypes } });
    }
  }

  console.log('FINAL HOSTEL FILTER:', JSON.stringify(filter, null, 2));

  // Sorting
  let sortOption = { createdAt: -1 };
  if (!isInvalid(sort)) {
    switch (sort) {
      case 'price_low': sortOption = { price: 1 }; break;
      case 'price_high': sortOption = { price: -1 }; break;
      case 'popular': sortOption = { totalRooms: -1 }; break; // Placeholder for popularity
      case 'newest': sortOption = { createdAt: -1 }; break;
      case 'rated': sortOption = { createdAt: 1 }; break; // Placeholder for rating
      default: sortOption = { createdAt: -1 };
    }
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Number(limit) || 12);
  const skip = (pageNum - 1) * limitNum;

  const hostels = await Hostel.find(filter)
    .populate('university', 'name location region')
    .populate('owner', 'name email phone profileImage')
    .skip(skip)
    .limit(limitNum)
    .sort(sortOption)
    .lean();

  const total = await Hostel.countDocuments(filter);

  const mappedHostels = hostels.map((h) => ({
    ...h,
    title: h.title || h.name,
    image: h.image || h.featuredImage || (h.images && h.images.length > 0 ? h.images[0] : null)
  }));

  sendSuccess(res, {
    total,
    currentPage: pageNum,
    totalPages: Math.ceil(total / limitNum),
    hostels: mappedHostels,
    results: mappedHostels
  }, 'Hostels retrieved successfully');
});

// GET OWNER HOSTELS
const getOwnerHostels = asyncHandler(async (req, res) => {
  const hostels = await Hostel.find({ owner: req.user._id })
    .populate('university', 'name location region')
    .sort({ createdAt: -1 })
    .lean();

  const mappedHostels = hostels.map((h) => ({
    ...h,
    title: h.title || h.name,
    image: h.image || h.featuredImage || (h.images && h.images.length > 0 ? h.images[0] : null)
  }));

  sendSuccess(res, mappedHostels, 'Owner hostels retrieved');
});

// GET SINGLE HOSTEL
const getSingleHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id)
    .populate('university', 'name location region')
    .populate('owner', 'name email phone profileImage')
    .lean();

  if (!hostel) return sendError(res, 'Hostel not found', 404);

  const h = {
    ...hostel,
    title: hostel.title || hostel.name,
    image: hostel.image || hostel.featuredImage || (hostel.images && hostel.images.length > 0 ? hostel.images[0] : null)
  };

  sendSuccess(res, h, 'Hostel details retrieved');
});

// GET ROOMS FOR A HOSTEL
const getHostelRooms = asyncHandler(async (req, res) => {
  const rooms = await Room.find({ hostel: req.params.id }).populate('hostel', 'name location').lean();
  sendSuccess(res, rooms, 'Hostel rooms retrieved');
});

// UPDATE HOSTEL
const updateHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id);
  if (!hostel) return sendError(res, 'Hostel not found', 404);
  if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return sendError(res, 'Not authorized to update this hostel', 401);
  }

  const updatedHostel = await Hostel.findByIdAndUpdate(
    req.params.id,
    pickHostelFields(req.body),
    { new: true, runValidators: true }
  );
  sendSuccess(res, updatedHostel, 'Hostel updated successfully');
});

// DELETE HOSTEL
const deleteHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id);
  if (!hostel) return sendError(res, 'Hostel not found', 404);
  if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return sendError(res, 'Not authorized to delete this hostel', 401);
  }
  await hostel.deleteOne();
  sendSuccess(res, null, 'Hostel deleted successfully');
});

module.exports = {
  createHostel,
  getHostels,
  getOwnerHostels,
  getSingleHostel,
  getHostelRooms,
  updateHostel,
  deleteHostel,
};
