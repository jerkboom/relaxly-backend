/**
 * Calculates the great-circle distance between two points on a sphere using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;

  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return parseFloat(distance.toFixed(2));
};

/**
 * Estimates walking time in minutes based on distance.
 * Average walking speed is ~5 km/h (12 mins per km).
 * @param {number} distanceKm 
 * @returns {number} Time in minutes
 */
const estimateWalkingTime = (distanceKm) => {
  if (!distanceKm) return null;
  return Math.round(distanceKm * 12);
};

module.exports = {
  calculateDistance,
  estimateWalkingTime,
};
