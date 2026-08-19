/**
 * Proxy Manager
 * Random proxy rotation to avoid IP blocking during crawl
 */
const { ProxyAgent } = require('undici');

const PROXY_IPS = [
    '109.110.161.71',
    '198.1.200.35',
    '109.111.36.136',
    '151.244.165.15',
    '151.245.244.77',
    '178.92.209.104',
    '191.96.73.119',
    '209.236.216.83',
    '64.69.118.43',
    '102.129.141.138',
    '138.36.92.137',
    '151.247.184.155',
    '167.250.111.223',
    '172.96.7.183',
    '185.228.195.58',
    '209.101.203.169',
    '40.27.109.202',
    '66.93.161.38',
    '74.0.101.29',
    '95.164.150.136',
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
