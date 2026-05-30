/**
 * API Features Builder (Pagination, Filtering, Sorting)
 */
class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'search'];
    excludedFields.forEach((el) => delete queryObj[el]);

    // Advanced filtering (gte, gt, lte, lt)
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  search(searchFields) {
    if (this.queryString.search && searchFields.length > 0) {
      const searchRegex = new RegExp(this.queryString.search, 'i');
      const searchConditions = searchFields.map(field => ({ [field]: searchRegex }));
      this.query = this.query.find({ $or: searchConditions });
    }
    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  paginate() {
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 10;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }
}

/**
 * Helper function to build pagination metadata
 */
const buildPaginationMeta = async (model, apiFeaturesInstance, limit) => {
  // Clone the query conditions without pagination to get total count
  const countQuery = model.find().merge(apiFeaturesInstance.query).skip(0).limit(0);
  const total = await countQuery.countDocuments();
  const page = parseInt(apiFeaturesInstance.queryString.page, 10) || 1;
  const parsedLimit = parseInt(apiFeaturesInstance.queryString.limit, 10) || limit || 10;

  return {
    total,
    page,
    limit: parsedLimit,
    totalPages: Math.ceil(total / parsedLimit),
  };
};

module.exports = {
  APIFeatures,
  buildPaginationMeta
};
