const cache = require('../utils/cache');

const normalizeValue = (value) => {
  if (value === undefined || value === null || value === '' || value === 'all') {
    return 'all';
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(',');
  }

  return String(value).trim().toLowerCase();
};

const createHostelSearchCacheKey = (query = {}) => {
  const search = normalizeValue(query.search);
  const university = normalizeValue(query.university);
  const location = normalizeValue(query.location);
  const amenities = normalizeValue(query.amenities);
  const capacity = normalizeValue(query.roomCapacity || query.roomTypes);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 12);
  const sort = normalizeValue(query.sort || 'newest');
  const minPrice = normalizeValue(query.minPrice);
  const maxPrice = normalizeValue(query.maxPrice);
  const gender = normalizeValue(query.gender);
  const verified = normalizeValue(query.verified);
  const availableNow = normalizeValue(query.availableNow);

  return [
    `hostels:search=${encodeURIComponent(search)}`,
    `university=${encodeURIComponent(university)}`,
    `location=${encodeURIComponent(location)}`,
    `amenities=${encodeURIComponent(amenities)}`,
    `capacity=${encodeURIComponent(capacity)}`,
    `page=${page}`,
    `limit=${limit}`,
    `sort=${encodeURIComponent(sort)}`,
    `minPrice=${encodeURIComponent(minPrice)}`,
    `maxPrice=${encodeURIComponent(maxPrice)}`,
    `gender=${encodeURIComponent(gender)}`,
    `verified=${encodeURIComponent(verified)}`,
    `availableNow=${encodeURIComponent(availableNow)}`,
  ].join(':');
};

const responseCache = ({ ttl = 300, keyBuilder }) => (req, res, next) => {
  if (req.method !== 'GET') return next();

  const startedAt = Date.now();
  const cacheKey = keyBuilder(req);
  const cached = cache.get(cacheKey);

  if (cached) {
    res.set('X-Cache', 'HIT');
    res.set('X-Response-Time-Ms', String(Date.now() - startedAt));
    return res.status(cached.statusCode || 200).json(cached.body);
  }

  res.set('X-Cache', 'MISS');
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const statusCode = res.statusCode;
    res.set('X-Response-Time-Ms', String(Date.now() - startedAt));

    if (statusCode >= 200 && statusCode < 300) {
      cache.set(cacheKey, { statusCode, body }, ttl);
    }

    return originalJson(body);
  };

  return next();
};

module.exports = {
  createHostelSearchCacheKey,
  responseCache,
};
