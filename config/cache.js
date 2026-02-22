const NodeCache = require('node-cache');

// Default TTL: 60s, check expired keys every 120s
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

/**
 * Get cached value by key
 * @param {string} key
 * @returns {*} cached value or undefined
 */
function cacheGet(key) {
    return cache.get(key);
}

/**
 * Set cache value with optional TTL
 * @param {string} key
 * @param {*} value
 * @param {number} [ttl] - TTL in seconds (0 = use default)
 */
function cacheSet(key, value, ttl = 0) {
    cache.set(key, value, ttl);
}

/**
 * Delete a specific cache key
 * @param {string} key
 */
function cacheDel(key) {
    cache.del(key);
}

/**
 * Delete all keys matching a prefix
 * @param {string} prefix
 */
function cacheDelPrefix(prefix) {
    const keys = cache.keys().filter(k => k.startsWith(prefix));
    if (keys.length > 0) cache.del(keys);
}

/**
 * Flush all cache
 */
function cacheFlush() {
    cache.flushAll();
}

/**
 * Get cache stats
 */
function cacheStats() {
    return cache.getStats();
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPrefix, cacheFlush, cacheStats };
