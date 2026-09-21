/**
 * Proxy Manager
 * Random proxy rotation to avoid IP blocking during crawl
 */
const { ProxyAgent } = require('undici');

const PROXY_IPS = [
    '151.245.244.89',
    '185.187.233.191',
    '109.111.36.113',
    '151.244.165.253',
    '198.1.200.16',
    '138.36.94.218',
    '85.208.11.130',
    '94.229.219.96',
    '66.93.165.30',
    '40.27.109.169',
    '72.244.46.197',
    '195.160.192.245',
    '95.164.207.105',
    '74.0.102.59',
    '185.228.195.192',
    '172.96.7.27',
    '209.101.200.212',
    '168.90.96.132',
    '193.169.219.112',
    '146.103.53.231',
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
