const cache = require('./cache');

const UNIVERSITIES = [
  {
    name: "University of Ghana",
    aliases: ["ug", "legon", "university of ghana", "ug legon", "ghana university"]
  },
  {
    name: "University of Professional Studies, Accra (UPSA)",
    aliases: ["upsa", "university of professional studies", "university of professional studies accra", "professional studies"]
  },
  {
    name: "Kwame Nkrumah University of Science and Technology (KNUST)",
    aliases: ["knust", "kwame nkrumah university", "tech", "knust university", "science and technology"]
  },
  {
    name: "University of Cape Coast (UCC)",
    aliases: ["ucc", "university of cape coast", "cape coast university"]
  },
  {
    name: "University for Development Studies (UDS)",
    aliases: ["uds", "university for development studies"]
  },
  {
    name: "University of Energy and Natural Resources (UENR)",
    aliases: ["uenr", "university of energy and natural resources"]
  },
  {
    name: "University of Education, Winneba (UEW)",
    aliases: ["uew", "university of education", "winneba"]
  },
  {
    name: "University of Health and Allied Sciences (UHAS)",
    aliases: ["uhas", "university of health and allied sciences", "health allied"]
  },
  {
    name: "Ashesi University",
    aliases: ["ashesi", "ashesi university"]
  },
  {
    name: "Wisconsin International University College",
    aliases: ["wisconsin", "wisconsin university", "wisconsin international"]
  },
  {
    name: "Valley View University",
    aliases: ["vvu", "valley view"]
  },
  {
    name: "Accra Technical University (ATU)",
    aliases: ["atu", "accra technical university"]
  },
  {
    name: "Kumasi Technical University (KsTU)",
    aliases: ["kstu", "kumasi technical university"]
  },
  {
    name: "Ho Technical University (HTU)",
    aliases: ["htu", "ho technical university"]
  },
  {
    name: "Takoradi Technical University (TTU)",
    aliases: ["ttu", "takoradi technical university"]
  },
  {
    name: "Sunyani Technical University (STU)",
    aliases: ["stu", "sunyani technical university"]
  },
  {
    name: "Koforidua Technical University (KTU)",
    aliases: ["ktu", "koforidua technical university"]
  },
  {
    name: "Cape Coast Technical University (CCTU)",
    aliases: ["cctu", "cape coast technical university"]
  },
  {
    name: "Tamale Technical University (TaTU)",
    aliases: ["tatu", "tamale technical university", "tatu tamale"]
  },
  {
    name: "Bolgatanga Technical University (BTU)",
    aliases: ["btu", "bolgatanga technical university"]
  },
  {
    name: "Wa Technical University (WTU)",
    aliases: ["wtu", "wa technical university"]
  }
];

/**
 * Normalizes a university search term to its official name.
 * If no match is found, returns the original value.
 */
const normalizeUniversity = (value) => {
  if (!value || typeof value !== 'string') return "";

  const search = value.toLowerCase().trim();
  const cacheKey = `university_lookup:normalize:${search}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const match = UNIVERSITIES.find((uni) =>
    uni.aliases.some((alias) =>
      search === alias.toLowerCase() || search.includes(alias.toLowerCase())
    ) ||
    uni.name.toLowerCase() === search ||
    search.includes(uni.name.toLowerCase())
  );

  const normalized = match ? match.name : value;
  cache.set(cacheKey, normalized, 86400);
  return normalized;
};

/**
 * Expands a search term into all its known aliases for regex matching.
 * This ensures that searching for "UG" matches "University of Ghana" and vice versa.
 */
const getUniversityAliases = (value) => {
  if (!value || typeof value !== 'string') return [];

  const search = value.toLowerCase().trim();
  const cacheKey = `university_lookup:aliases:${search}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const match = UNIVERSITIES.find((uni) =>
    uni.aliases.some((alias) =>
      search === alias.toLowerCase() || search.includes(alias.toLowerCase())
    ) ||
    uni.name.toLowerCase() === search ||
    search.includes(uni.name.toLowerCase())
  );

  if (match) {
    // Return all aliases plus the official name
    const aliases = [...new Set([match.name, ...match.aliases])];
    cache.set(cacheKey, aliases, 86400);
    return aliases;
  }

  const aliases = [value];
  cache.set(cacheKey, aliases, 86400);
  return aliases;
};

module.exports = {
  UNIVERSITIES,
  normalizeUniversity,
  getUniversityAliases
};
