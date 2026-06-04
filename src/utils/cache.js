/**
 * A simple in-memory cache implementation
 * In a production environment, this should be replaced with Redis.
 */
class Cache {
  constructor(maxEntries = 1000) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.stats = {
      hits: 0,
      misses: 0,
    };
  }

  set(key, value, ttl = 300) {
    // Memory protection: Evict oldest if full
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const expiresAt = Date.now() + ttl * 1000;
    this.cache.set(key, { value, expiresAt });
  }

  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    
    // Move to end (LRU behavior)
    const value = item.value;
    const expiresAt = item.expiresAt;
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt });
    
    return value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  deleteMatching(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRatio = totalRequests === 0 ? 0 : (this.stats.hits / totalRequests) * 100;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatio: `${hitRatio.toFixed(2)}%`,
      entries: this.cache.size,
      maxEntries: this.maxEntries
    };
  }

  clear() {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}

module.exports = new Cache(2000); // 2000 entry limit
