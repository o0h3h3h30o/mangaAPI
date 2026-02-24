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
    '151.245.245.195',
    '62.192.172.221',
];

/**
 * Get a random proxy dispatcher (undici ProxyAgent)
 * Returns null if proxy is not configured
 */
function getRandomProxy() {
    const user = process.env.PROXY_USER;
    const pass = process.env.PROXY_PASS;
    const port = process.env.PROXY_PORT || '50100';

    if (!user || !pass) return null;

    const ip = PROXY_IPS[Math.floor(Math.random() * PROXY_IPS.length)];
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
