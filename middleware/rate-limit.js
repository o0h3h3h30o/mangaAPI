const rateLimit = require('express-rate-limit');

// Global: 500 requests per minute per IP
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
});

// Write endpoints: 30 requests per minute per IP
const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests' },
});

// Search: 100 requests per minute per IP
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many search requests' },
});

module.exports = { globalLimiter, writeLimiter, searchLimiter };
