/**
 * Cache-Control middleware for Cloudflare CDN
 * Sets s-maxage (CF edge cache) and max-age (browser cache)
 */

function cfCache(edgeSeconds, browserSeconds = 0) {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') return next();

        const parts = [`public`, `s-maxage=${edgeSeconds}`];
        if (browserSeconds > 0) {
            parts.push(`max-age=${browserSeconds}`);
        } else {
            parts.push(`max-age=0`);
        }
        parts.push('stale-while-revalidate=60');

        res.set('Cache-Control', parts.join(', '));
        res.set('CDN-Cache-Control', `public, max-age=${edgeSeconds}`);
        next();
    };
}

// Presets
const cache = {
    // Homepage data: top, newest, hot-new-releases
    short: cfCache(300, 60),        // CF 5min, browser 1min

    // Manga detail, chapter list, category list
    medium: cfCache(1800, 300),     // CF 30min, browser 5min

    // Chapter detail, chapter images (rarely change)
    long: cfCache(86400, 3600),     // CF 24h, browser 1h

    // Search results
    search: cfCache(600, 60),       // CF 10min, browser 1min

    // No cache (auth, POST, mutations)
    none: (req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        next();
    },
};

module.exports = { cfCache, cache };
