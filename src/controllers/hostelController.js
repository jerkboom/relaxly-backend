const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const stringSimilarity = require('string-similarity');

const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const cache = require('../utils/cache');
const {
  HOSTEL_COUNT_PREFIX,
  invalidateHostelBrowseCaches,
} = require('../utils/hostelCache');
const { logOwnerActivity } = require('../utils/ownerActivityLogger');
const { calculateDistance, estimateWalkingTime } = require('../utils/distanceUtils');
const { normalizeUniversity, getUniversityAliases } = require('../utils/universityUtils');


const transformHostelResponse = (hostel) => {
  if (!hostel) return null;
  
  const h = { ...hostel };
  
  // Ensure title and image fallbacks
  h.title = h.title || h.name;
  h.image = h.image || h.featuredImage || (h.images && h.images.length > 0 ? h.images[0] : null);

  // Robust Location Transformation
  if (h.location && typeof h.location === 'object') {
    // Preserve full details in locationDetails
    h.locationDetails = JSON.parse(JSON.stringify(h.location));
    
    // Expose root level coordinates
    h.latitude = h.location.latitude;
    h.longitude = h.location.longitude;

    // Flatten primary location field to String (Backward Compatibility & React safety)
    h.location = h.location.address || '';
  }

  return h;
};

const pickHostelFields = (body) => {
  const allowedFields = [
    'name', 'description', 'location', 'price', 'pricingType', 'images', 'featuredImage',
    'amenities', 'rules', 'policies', 'university', 'nearestUniversity', 'nearbyUniversities', 'available',
    'wifi', 'ac', 'security', 'water', 'electricity', 'totalRooms', 'availableRooms', 'genderAllowed',
  ];
  const update = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      let value = body[field];
      
      // Normalize location for backward compatibility
      if (field === 'location' && typeof value === 'string') {
        value = {
          address: value,
          city: '',
          region: '',
        };
      }
      
      update[field] = value;
    }
  });

  // Handle root-level coordinates if provided separately from location object
  if (body.latitude !== undefined || body.longitude !== undefined) {
    if (typeof update.location !== 'object') {
      update.location = { address: update.location || '', city: '', region: '' };
    }
    if (body.latitude !== undefined) update.location.latitude = Number(body.latitude);
    if (body.longitude !== undefined) update.location.longitude = Number(body.longitude);
  }

  return update;
};

// CREATE HOSTEL
const createHostel = asyncHandler(async (req, res) => {
  const data = pickHostelFields(req.body);
  // UNIVERSITY VALIDATION: 1 Primary + Max 4 Nearby (Total 5)
  if (!data.nearestUniversity) {
    return sendError(res, 'Primary University is required', 400);
  }

  if (data.nearbyUniversities) {
    // Remove duplicates and ensure primary isn't in nearby
    data.nearbyUniversities = [...new Set(data.nearbyUniversities)]
      .filter(u => u !== data.nearestUniversity)
      .slice(0, 10);
    
    if (data.nearbyUniversities.length > 10) {
      return sendError(res, 'You can select a maximum of 10 nearby universities.', 400);
    }
  }

  
  console.log('[DEBUG] Creating Hostel with data:', JSON.stringify(data, null, 2));

  const hostel = await Hostel.create({
    ...data,
    owner: req.user.id,
  });

  console.log('[DEBUG] Hostel Created successfully. ID:', hostel._id, 'Coords:', hostel.location?.latitude, hostel.location?.longitude);

  // LOG ACTIVITY
  await logOwnerActivity({
    ownerId: req.user.id,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    eventType: 'hostel',
    title: 'Hostel Created',
    description: `Owner created ${hostel.name}`,
    metadata: {
      hostelId: hostel._id,
      hostelName: hostel.name,
      location: hostel.location
    }
  });

  invalidateHostelBrowseCaches(hostel);

  sendSuccess(res, hostel, 'Hostel created successfully', 201);
});

// GET ALL HOSTELS WITH SEARCH, FILTERING, SORTING & PAGINATION
const getHostels = asyncHandler(async (req, res) => {
  try {
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
      roomCapacity,
      sort,
      page = 1,
      limit = 12,
    } = req.query;

    // FILTER OBJECT - Start with public-safe defaults
    let filter = {
      verificationStatus: 'approved',
      available: true,
    };

    const isInvalid = (val) => !val || val === 'undefined' || val === 'null' || val === 'all' || val === '';

    // Use an array to collect complex conditions that will be combined with $and
    const conditions = [];

    // 1. General Search Filter & University Alias Matching
    if (!isInvalid(search)) {
      const searchTerms = [search];
      const aliases = getUniversityAliases(search);
      if (aliases.length > 0) searchTerms.push(...aliases);

      const orConditions = [];
      searchTerms.forEach(term => {
        const regex = { $regex: String(term), $options: 'i' };
        orConditions.push(
          { name: regex },
          { nearestUniversity: regex },
          { nearbyUniversities: regex },
          { 'location.address': regex },
          { 'location.city': regex },
          { 'location.region': regex },
          { description: regex }
        );
      });

      conditions.push({ $or: orConditions });
    }

    // 2. Location filter (acts as specialized search)
    if (!isInvalid(location)) {
      const locationAliases = getUniversityAliases(location);
      const locTerms = [location, ...locationAliases];

      const orConditions = [];
      locTerms.forEach(term => {
        const regex = { $regex: String(term), $options: 'i' };
        orConditions.push(
          { 'location.address': regex },
          { 'location.city': regex },
          { 'location.region': regex },
          { nearestUniversity: regex },
          { nearbyUniversities: regex }
        );
      });
      conditions.push({ $or: orConditions });
    }

    // 3. University filter (explicit selection)
    if (!isInvalid(university)) {
      const normalized = normalizeUniversity(university);
      const aliases = getUniversityAliases(normalized);
      const uniTerms = [...new Set([university, normalized, ...aliases])];

      const orConditions = uniTerms.map(term => ({
        $or: [
          { nearestUniversity: { $regex: String(term), $options: 'i' } },
          { nearbyUniversities: { $regex: String(term), $options: 'i' } }
        ]
      })).flatMap(cond => cond.$or);

      if (mongoose.Types.ObjectId.isValid(university)) {
        orConditions.push({ university: university });
      }

      conditions.push({ $or: orConditions });
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

    // Amenities filter (Requires ALL selected amenities - ID Based)
    if (!isInvalid(amenities)) {
      const amenitiesArray = Array.isArray(amenities) ? amenities : String(amenities).split(',').map(a => a.trim());
      const validAmenities = amenitiesArray.filter(a => a !== '');

      if (validAmenities.length > 0) {
        validAmenities.forEach(a => {
          const id = a.toLowerCase();
          // Map central IDs to DB fields/logic
          if (id === 'wifi') conditions.push({ wifi: true });
          else if (id === 'ac') conditions.push({ ac: true });
          else if (id === 'security') conditions.push({ security: true });
          else if (id === 'water_supply') conditions.push({ water: true });
          else if (id === 'generator') conditions.push({ electricity: true });
          else if (id === 'private_washroom') conditions.push({ amenities: { $regex: /private washroom/i } });
          else if (id === 'shared_washroom') conditions.push({ amenities: { $regex: /shared washroom/i } });
          else if (id === 'kitchen') conditions.push({ amenities: { $regex: /[^d] kitchen/i } }); // Not shared
          else if (id === 'shared_kitchen') conditions.push({ amenities: { $regex: /shared kitchen/i } });
          else if (id === 'study_area') conditions.push({ amenities: { $regex: /study area|desk/i } });
          else if (id === 'parking') conditions.push({ amenities: { $regex: /parking/i } });
          else if (id === 'laundry') conditions.push({ amenities: { $regex: /laundry|washing/i } });
          else if (id === 'refrigerator') conditions.push({ amenities: { $regex: /refrigerator|fridge/i } });
          else if (id === 'wardrobe') conditions.push({ amenities: { $regex: /wardrobe/i } });
          else if (id === 'balcony') conditions.push({ amenities: { $regex: /balcony/i } });
          else if (id === 'television') conditions.push({ amenities: { $regex: /television|tv/i } });
          else if (id === 'ceiling_fan') conditions.push({ amenities: { $regex: /fan/i } });
          else conditions.push({ amenities: { $in: [a] } });
        });
      }
    }

    // Room Types / Capacity filter
    const selectedRoomTypes = roomTypes || roomCapacity;
    if (!isInvalid(selectedRoomTypes)) {
      const roomTypesArray = Array.isArray(selectedRoomTypes) ? selectedRoomTypes : String(selectedRoomTypes).split(',').map(t => t.trim());
      const validTypes = roomTypesArray.filter(t => t !== '');

      if (validTypes.length > 0) {
        const mappedTypes = validTypes.map(t => {
           const low = t.toLowerCase();
           if (low === 'single') return '1-in-1';
           if (low === 'double') return '2-in-1';
           if (low === 'triple') return '3-in-1';
           if (low === 'quad') return '4-in-1';
           if (low.includes('5')) return '5-in-1';
           if (low.includes('6')) return '6-in-1';
           if (low.includes('7')) return '7-in-1';
           if (low.includes('8')) return '8-in-1';
           return t;
        });

        const hostelsWithRoomTypes = await Room.distinct('hostel', {
          occupancyStyle: { $in: mappedTypes },
          roomStatus: 'available',
          availableBeds: { $gt: 0 }
        });

        conditions.push({ _id: { $in: hostelsWithRoomTypes } });
      }
    }

    // Combine all conditions into the main filter
    if (conditions.length > 0) {
      filter.$and = conditions;
    }

    console.log('FINAL HOSTEL FILTER:', JSON.stringify(filter, null, 2));

    // Sorting
    let sortOption = { createdAt: -1 };
    if (!isInvalid(sort)) {
      switch (sort) {
        case 'price_low': sortOption = { price: 1 }; break;
        case 'price_high': sortOption = { price: -1 }; break;
        case 'popular': sortOption = { totalRooms: -1 }; break;
        case 'newest': sortOption = { createdAt: -1 }; break;
        case 'rated': sortOption = { createdAt: 1 }; break;
        default: sortOption = { createdAt: -1 };
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 12);
    const skip = (pageNum - 1) * limitNum;

    const hostels = await Hostel.find(filter)
      .populate('university', 'name location region')
      .populate('owner', 'name profileImage isOwnerVerified verificationStatus')
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Option 3: Dynamic Projected Summary lookup for fetched hostels
    const hostelIds = hostels.map(h => h._id);
    const rooms = await Room.find(
      { hostel: { $in: hostelIds }, roomStatus: 'available' },
      { hostel: 1, occupancyStyle: 1, price: 1, totalPrice: 1, availableBeds: 1, roomStatus: 1 }
    ).lean();

    const roomSummaryMap = {};
    rooms.forEach(room => {
      const hostelId = room.hostel.toString();
      const style = room.occupancyStyle || '1-in-1';
      const price = room.totalPrice !== undefined ? room.totalPrice : room.price;
      
      if (!roomSummaryMap[hostelId]) {
        roomSummaryMap[hostelId] = {};
      }
      
      const existing = roomSummaryMap[hostelId][style];
      if (!existing || price < existing.price) {
        roomSummaryMap[hostelId][style] = {
          occupancyStyle: style,
          price: price,
          availableBeds: room.availableBeds || 0
        };
      }
    });

    hostels.forEach(h => {
      const summaryObj = roomSummaryMap[h._id.toString()];
      h.roomSummary = summaryObj ? Object.values(summaryObj).sort((a, b) => a.price - b.price) : [];
    });


    // RANKING: High-Relevance Discovery (Primary Matches First)
    if (university && !isInvalid(university)) {
      const targetUni = normalizeUniversity(university).toLowerCase();
      hostels.sort((a, b) => {
        const aPrimary = normalizeUniversity(a.nearestUniversity || '').toLowerCase() === targetUni;
        const bPrimary = normalizeUniversity(b.nearestUniversity || '').toLowerCase() === targetUni;
        const aSecondary = a.nearbyUniversities?.some(u => normalizeUniversity(u).toLowerCase() === targetUni);
        const bSecondary = b.nearbyUniversities?.some(u => normalizeUniversity(u).toLowerCase() === targetUni);
        if (aPrimary && !bPrimary) return -1;
        if (!aPrimary && bPrimary) return 1;
        if (aSecondary && !bSecondary) return -1;
        if (!aSecondary && bSecondary) return 1;
        return 0;
      });
    }

    const total = await Hostel.countDocuments(filter);

    const mappedHostels = hostels.map(transformHostelResponse);

    const responseData = {
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hostels: mappedHostels,
      results: mappedHostels
    };

    sendSuccess(res, responseData, 'Hostels retrieved successfully');
  } catch (error) {
    console.error('CRITICAL ERROR IN GETHOSTELS:', error);
    return sendError(res, 'Internal Server Error during hostel search', 500);
  }
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
  const cacheKey = `hostel_details_${req.params.id}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return sendSuccess(res, cached, 'Hostel details retrieved from cache');
  }

  const hostel = await Hostel.findById(req.params.id)
    .populate('university', 'name location region latitude longitude')
    .populate('owner', 'name profileImage isOwnerVerified verificationStatus')
    .lean();

  if (!hostel) return sendError(res, 'Hostel not found', 404);

  console.log("--- PROXIMITY CALCULATION AUDIT ---");
  console.log("HOSTEL LOCATION", hostel.location);
  console.log("HOSTEL LAT", hostel.location?.latitude);
  console.log("HOSTEL LNG", hostel.location?.longitude);

  console.log("UNIVERSITY (POPULATED)", hostel.university);
  console.log("UNI LAT", hostel.university?.latitude);
  console.log("UNI LNG", hostel.university?.longitude);

  console.log('[DEBUG] Fetched Hostel:', hostel._id, 'Coords in DB:', hostel.location?.latitude, hostel.location?.longitude);

  // DISTANCE CALCULATION
  let nearestInstitution = null;
  let distanceKm = null;
  let walkingMinutes = null;

  if (hostel.university && hostel.university.latitude && hostel.university.longitude) {
    const hostelLat = hostel.location?.latitude;
    const hostelLon = hostel.location?.longitude;
    const uniLat = hostel.university.latitude;
    const uniLon = hostel.university.longitude;

    if (hostelLat && hostelLon) {
      distanceKm = calculateDistance(hostelLat, hostelLon, uniLat, uniLon);
      walkingMinutes = estimateWalkingTime(distanceKm);
      nearestInstitution = {
        name: hostel.university.name,
        distanceKm,
        walkingMinutes
      };
    }
  }

  console.log("NEAREST INSTITUTION RESULT:", nearestInstitution);
  console.log("-----------------------------------");

  const h = {
    ...hostel,
    // BACKWARD COMPATIBILITY: Flatten location object to string
    location: hostel.location && typeof hostel.location === 'object' ? hostel.location.address : hostel.location,
    latitude: hostel.location?.latitude,
    longitude: hostel.location?.longitude,
    locationDetails: hostel.location,
    nearestInstitution, // New field for calculated proximity
    title: hostel.title || hostel.name,
    image: hostel.image || hostel.featuredImage || (hostel.images && hostel.images.length > 0 ? hostel.images[0] : null)
  };

  console.log('[DEBUG] Returning mapped hostel with proximity:', JSON.stringify(nearestInstitution));

  console.log('[DEBUG] Returning mapped hostel with root coords:', h.latitude, h.longitude);

  // CACHE DATA
  cache.set(cacheKey, h, 600); // 10 minutes

  sendSuccess(res, h, 'Hostel details retrieved');
});

/**
 * @desc    Get owner contact details if student has a booking
 * @route   GET /api/hostels/:id/contact
 * @access  Private
 */
const getHostelContactDetails = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id).select('owner name');
  if (!hostel) return sendError(res, 'Hostel not found', 404);

  const userId = req.user.id;
  const userRole = req.user.role;

  // 1. Full Access: Admin or the Owner of the hostel
  if (userRole === 'admin' || hostel.owner.toString() === userId) {
    const owner = await User.findById(hostel.owner).select('name email phone whatsapp profileImage');
    
    logLifecycleEvent('contact_access_granted', {
      studentId: userId,
      hostelId: hostel._id,
      actorRole: userRole,
      reason: 'direct_access'
    });

    return sendSuccess(res, owner, 'Owner contact info retrieved');
  }

  // 2. Gated Access: Student with a valid booking
  const Booking = require('../models/Booking');
  const booking = await Booking.findOne({
    student: userId,
    hostel: hostel._id,
    bookingStatus: { $in: ['pending', 'approved', 'checked_in', 'completed'] }
  }).select('_id bookingStatus');

  if (!booking) {
    logLifecycleEvent('contact_access_denied', {
      studentId: userId,
      hostelId: hostel._id,
      reason: 'no_valid_booking'
    });

    return sendError(res, 'Book a room to access host contact information', 403);
  }

  // Access Granted
  const owner = await User.findById(hostel.owner).select('name email phone whatsapp profileImage');
  
  logLifecycleEvent('contact_access_granted', {
    studentId: userId,
    hostelId: hostel._id,
    bookingId: booking._id,
    reason: 'valid_booking'
  });

  sendSuccess(res, owner, 'Owner contact info retrieved');
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

  const oldAvailable = hostel.available;
  const updateData = pickHostelFields(req.body);
  const data = updateData; // For validation logic
  // UNIVERSITY VALIDATION: 1 Primary + Max 4 Nearby (Total 5)
  const effectiveNearestUniversity = data.nearestUniversity ?? hostel.nearestUniversity;
  if (!effectiveNearestUniversity) {
    return sendError(res, 'Primary University is required', 400);
  }

  if (data.nearbyUniversities) {
    // Remove duplicates and ensure primary isn't in nearby
    data.nearbyUniversities = [...new Set(data.nearbyUniversities)]
      .filter(u => u !== effectiveNearestUniversity)
      .slice(0, 10);
    
    if (data.nearbyUniversities.length > 10) {
      return sendError(res, 'You can select a maximum of 10 nearby universities.', 400);
    }
  }


  // SMART MERGE FOR LOCATION: Prevent wiping out coordinates during partial updates
  if (updateData.location) {
    const existingLocation = typeof hostel.location === 'object' ? hostel.location : {};
    
    // If we received a string, it's already been normalized to {address: "..."} by pickHostelFields
    // If we received an object, we merge it with the existing one
    updateData.location = {
      address: updateData.location.address || existingLocation.address || '',
      city: updateData.location.city || existingLocation.city || '',
      region: updateData.location.region || existingLocation.region || '',
      latitude: updateData.location.latitude ?? existingLocation.latitude,
      longitude: updateData.location.longitude ?? existingLocation.longitude
    };
  }

  const updatedHostel = await Hostel.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  );

  console.log('[DEBUG] Hostel Updated successfully. ID:', updatedHostel._id, 'Coords:', updatedHostel.location?.latitude, updatedHostel.location?.longitude);

  // LOG ACTIVITY
  let activityTitle = 'Hostel Updated';
  let activityDesc = `Owner updated ${updatedHostel.name}`;

  if (updateData.available !== undefined && updateData.available !== oldAvailable) {
    activityTitle = updateData.available ? 'Hostel Published' : 'Hostel Unpublished';
    activityDesc = `Owner ${updateData.available ? 'published' : 'unpublished'} ${updatedHostel.name}`;
  }

  await logOwnerActivity({
    ownerId: req.user.id,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    eventType: 'hostel',
    title: activityTitle,
    description: activityDesc,
    metadata: {
      hostelId: updatedHostel._id,
      hostelName: updatedHostel.name,
      updatedFields: Object.keys(updateData)
    }
  });

  invalidateHostelBrowseCaches(hostel);
  invalidateHostelBrowseCaches(updatedHostel);

  sendSuccess(res, updatedHostel, 'Hostel updated successfully');
});

// DELETE HOSTEL
const deleteHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id);
  if (!hostel) return sendError(res, 'Hostel not found', 404);
  if (hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return sendError(res, 'Not authorized to delete this hostel', 401);
  }

  // CAPTURE INFO BEFORE DELETE
  const hostelName = hostel.name;
  const ownerId = hostel.owner;

  await hostel.deleteOne();

  // LOG ACTIVITY
  await logOwnerActivity({
    ownerId: ownerId,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    eventType: 'hostel',
    title: 'Hostel Deleted',
    description: `Owner deleted ${hostelName}`,
    metadata: {
      hostelId: req.params.id,
      hostelName: hostelName
    }
  });

  invalidateHostelBrowseCaches(hostel);

  sendSuccess(res, null, 'Hostel deleted successfully');
});





// GET ACTIVE UNIVERSITIES (With Counts)
const getActiveUniversities = asyncHandler(async (req, res) => {
  const cached = cache.get(HOSTEL_COUNT_PREFIX);
  if (cached) {
    return sendSuccess(res, cached, 'Active universities retrieved from cache');
  }

  const pipeline = [
    {
      $match: {
        verificationStatus: 'approved',
        available: true,
        nearestUniversity: { $nin: ['', null] },
      },
    },
    { $group: { _id: "$nearestUniversity", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ];
  const results = await Hostel.aggregate(pipeline);
  cache.set(HOSTEL_COUNT_PREFIX, results, 21600);
  sendSuccess(res, results, 'Active universities retrieved');
});

// GET SEARCH SUGGESTIONS (FUZZY & RANKED)
const getSearchSuggestions = asyncHandler(async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q || q.trim().length === 0) {
      return sendSuccess(res, { suggestions: [] }, 'Empty query');
    }

    const queryLower = q.trim().toLowerCase();
    const cacheKey = `suggestions:${queryLower}`;

    // 1. Check Backend Cache First for search suggestions result
    const cachedSuggestions = cache.get(cacheKey);
    if (cachedSuggestions) {
      return sendSuccess(res, { suggestions: cachedSuggestions }, 'Suggestions retrieved from cache');
    }

    const queryAliases = getUniversityAliases(queryLower).map(a => a.toLowerCase());

    // 2. Retrieve compiled global candidates list from cache or build it
    const globalCandidatesKey = 'suggestions:global_candidates';
    let globalCandidates = cache.get(globalCandidatesKey);

    if (!globalCandidates) {
      // Build candidates array once from all available and approved hostels (projecting minimal search fields)
      const hostels = await Hostel.find({
        verificationStatus: 'approved',
        available: true
      })
      .select('name location nearestUniversity nearbyUniversities')
      .lean();

      const candidatesMap = new Map();

      hostels.forEach(hostel => {
        // 1. Hostel Name
        if (hostel.name) {
          const nameTrimmed = hostel.name.trim();
          const key = `hostel:${nameTrimmed.toLowerCase()}`;
          if (!candidatesMap.has(key)) {
            candidatesMap.set(key, { type: 'hostel', name: nameTrimmed });
          }
        }

        // 2. Location details (City, Region, Address)
        if (hostel.location) {
          const { address, city, region } = hostel.location;
          if (address) {
            const val = address.trim();
            const key = `location:${val.toLowerCase()}`;
            if (!candidatesMap.has(key)) {
              candidatesMap.set(key, { type: 'location', name: val });
            }
          }
          if (city) {
            const val = city.trim();
            const key = `location:${val.toLowerCase()}`;
            if (!candidatesMap.has(key)) {
              candidatesMap.set(key, { type: 'location', name: val });
            }
          }
          if (region) {
            const val = region.trim();
            const key = `location:${val.toLowerCase()}`;
            if (!candidatesMap.has(key)) {
              candidatesMap.set(key, { type: 'location', name: val });
            }
          }
        }

        // 3. University details (Nearest and Nearby)
        if (hostel.nearestUniversity) {
          const val = hostel.nearestUniversity.trim();
          const key = `university:${val.toLowerCase()}`;
          if (!candidatesMap.has(key)) {
            candidatesMap.set(key, { type: 'university', name: val });
          }
        }

        if (Array.isArray(hostel.nearbyUniversities)) {
          hostel.nearbyUniversities.forEach(uni => {
            if (uni) {
              const val = uni.trim();
              const key = `university:${val.toLowerCase()}`;
              if (!candidatesMap.has(key)) {
                candidatesMap.set(key, { type: 'university', name: val });
              }
            }
          });
        }
      });

      globalCandidates = Array.from(candidatesMap.values());
      // Cache global candidates list for 15 minutes
      cache.set(globalCandidatesKey, globalCandidates, 900);
    }

    const scoredCandidates = [];

    // 3. Perform in-memory search and fuzzy matching on the global candidates list
    for (const candidate of globalCandidates) {
      const nameLower = candidate.name.toLowerCase();
      let score = 0;

      // Exact Match
      if (nameLower === queryLower) {
        score += 10.0;
      }
      // Starts with match
      else if (nameLower.startsWith(queryLower)) {
        score += 8.0;
      }
      // Substring match
      else if (nameLower.includes(queryLower)) {
        score += 5.0;
      }

      // Alias match: check if the query is an alias of the candidate or vice versa
      const candidateAliases = getUniversityAliases(candidate.name).map(a => a.toLowerCase());
      const isAliasMatch = candidateAliases.some(alias => 
        alias === queryLower || alias.startsWith(queryLower) || queryAliases.includes(alias)
      );
      if (isAliasMatch) {
        score += 7.0;
      }

      // Fuzzy match
      const fuzzy = stringSimilarity.compareTwoStrings(queryLower, nameLower);
      let bestFuzzy = fuzzy;
      candidateAliases.forEach(alias => {
        const f = stringSimilarity.compareTwoStrings(queryLower, alias);
        if (f > bestFuzzy) {
          bestFuzzy = f;
        }
      });

      if (bestFuzzy > 0.3) {
        score += bestFuzzy * 4.0;
      }

      if (score > 0) {
        scoredCandidates.push({
          ...candidate,
          score
        });
      }
    }

    // Sort descending by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Get top 10 unique suggestions
    const suggestions = scoredCandidates.slice(0, 10).map(item => ({
      type: item.type,
      name: item.name
    }));

    // Cache the calculated suggestions for 5 minutes (300 seconds)
    cache.set(cacheKey, suggestions, 300);

    sendSuccess(res, { suggestions }, 'Suggestions retrieved successfully');
  } catch (error) {
    console.error('ERROR IN GETSEARCHSUGGESTIONS:', error);
    return sendError(res, 'Internal Server Error during suggestions lookup', 500);
  }
});

module.exports = {
  getSearchSuggestions,
  getActiveUniversities,
  createHostel,
  getHostels,
  getOwnerHostels,
  getSingleHostel,
  getHostelRooms,
  getHostelContactDetails,
  updateHostel,
  deleteHostel,
};
