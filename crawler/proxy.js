/**
 * Proxy Manager
 * Random proxy rotation to avoid IP blocking during crawl
 */
const { ProxyAgent } = require('undici');

const PROXY_IPS = [
    '150.241.251.128',
    '96.62.127.157',
    '216.180.245.224',
    '146.103.51.77',
    '74.115.1.65',
    '94.131.56.12',
    '138.36.95.221',
    '45.73.181.12',
    '89.19.59.88',
    '185.228.192.57',
    '95.164.206.102',
    '66.78.44.36',
    '64.113.0.189',
    '104.219.171.66',
    '93.190.247.51',
    '109.111.36.108',
    '109.111.37.190',
    '200.234.138.192',
];

// Shuffle array (Fisher-Yates) to avoid always hitting the same proxy
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Round-robin index — cycles through shuffled list so each request uses a different proxy
let proxyPool = shuffle([...PROXY_IPS]);
let poolIdx = 0;

/**
 * Get next proxy dispatcher (round-robin through shuffled list)
 * Returns null if proxy is not configured
 */
function getRandomProxy() {
    const user = process.env.PROXY_USER;
    const pass = process.env.PROXY_PASS;
    const port = process.env.PROXY_PORT || '50100';

    if (!user || !pass) return null;

    // Re-shuffle when we've used all proxies
    if (poolIdx >= proxyPool.length) {
        proxyPool = shuffle([...PROXY_IPS]);
        poolIdx = 0;
    }

    const ip = proxyPool[poolIdx++];
    const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;

    return new ProxyAgent(proxyUrl);
}

/**
 * Get proxy-enabled fetch options (merge with existing options)
 */
function withProxy(options = {}) {
    const dispatcher = getRandomProxy();
    if (!dispatcher) return options;
    return { ...options, dispatcher };
}

module.exports = {
    getRandomProxy,
    withProxy,
    PROXY_IPS,
};
