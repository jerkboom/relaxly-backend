const cache = require('./cache');
const { normalizeUniversity } = require('./universityUtils');

const HOSTEL_SEARCH_PREFIX = 'hostels:';
const HOSTEL_COUNT_PREFIX = 'hostel_counts:';

const getUniversityNamesForHostel = (hostel = {}) => {
  const names = [
    hostel.nearestUniversity,
    ...(Array.isArray(hostel.nearbyUniversities) ? hostel.nearbyUniversities : []),
  ];

  return [...new Set(names.filter(Boolean).map((name) => normalizeUniversity(String(name)).toLowerCase()))];
};

const invalidateHostelBrowseCaches = (hostel = {}) => {
  if (!hostel) return 0;

  const universities = getUniversityNamesForHostel(hostel);

  if (hostel._id || hostel.id) {
    cache.delete(`hostel_details_${hostel._id || hostel.id}`);
  }
  cache.delete(HOSTEL_COUNT_PREFIX);

  return cache.deleteWhere((key) => {
    if (!key.startsWith(HOSTEL_SEARCH_PREFIX)) return false;

    const decodedKey = decodeURIComponent(key).toLowerCase();
    const hasGlobalUniversityScope = decodedKey.includes('university=all') && decodedKey.includes('location=all');
    const hasAffectedUniversity = universities.some((university) => decodedKey.includes(university));

    return hasGlobalUniversityScope || hasAffectedUniversity;
  });
};

const invalidateUniversityLookupCaches = () => {
  cache.delete('universities');
  cache.deleteMatching('university_lookup:');
  cache.delete(HOSTEL_COUNT_PREFIX);
  cache.deleteWhere((key) => key.startsWith(HOSTEL_SEARCH_PREFIX) && key.includes('university='));
};

module.exports = {
  HOSTEL_COUNT_PREFIX,
  HOSTEL_SEARCH_PREFIX,
  getUniversityNamesForHostel,
  invalidateHostelBrowseCaches,
  invalidateUniversityLookupCaches,
};
