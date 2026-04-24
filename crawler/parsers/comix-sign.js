const { withProxy } = require('../proxy');
const { USER_AGENT } = require('./base');

const SIGNING_NOT_IMPL = new Error(
    'comix signing unavailable — could not load the current Comix API signer.'
);

const BASE_URL = 'https://comix.to';

let signerPromise = null;
let signQueue = Promise.resolve();

async function fetchText(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        opts.fetchTimeoutMs || 30000
    );
    try {
        const res = await fetch(url, withProxy({
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': opts.accept || '*/*',
                'Referer': BASE_URL + '/',
                ...(opts.headers || {}),
            },
            signal: controller.signal,
        }));
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.text();
    } finally {
        clearTimeout(timer);
    }
}

function extractScriptUrls(html) {
    const urls = new Set();
    const re = /<script[^>]+src="([^"]+\.js)"[^>]*>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
        const src = match[1];
        urls.add(src.startsWith('http') ? src : `${BASE_URL}${src}`);
    }
    return [...urls];
}

function extractApiModule(chunk) {
    const start = chunk.indexOf('9165,e=>');
    if (start === -1) return null;

    const end = chunk.indexOf('},3053,e=>', start);
    if (end === -1) return null;

    // The bundle stores modules as `9165,e=>{...},3053,e=>...`.
    // Slice the API module and add back the closing brace consumed by the delimiter.
    return chunk.slice(start, end).replace(/^9165,/, '') + '}';
}

function evaluateApiModule(moduleSource) {
    const exports = {};
    const moduleApi = {
        i(id) {
            if (id === 85696) return { default: { env: {} } };
            return {};
        },
        s(items) {
            for (let i = 0; i < items.length; i += 3) {
                exports[items[i]] = items[i + 2];
            }
        },
    };

    // Evaluates Comix's browser API client in-process so requests are signed
    // exactly like the site. The module is fetched from comix.to and cached.
    const factory = eval(`(${moduleSource})`);
    factory(moduleApi);

    if (!exports.apiClient || typeof exports.apiClient.get !== 'function') {
        throw SIGNING_NOT_IMPL;
    }
    return exports.apiClient;
}

async function loadApiClient() {
    const html = await fetchText(`${BASE_URL}/home`, { accept: 'text/html' });
    const scripts = extractScriptUrls(html);

    for (const scriptUrl of scripts) {
        const chunk = await fetchText(scriptUrl, {
            accept: 'application/javascript,*/*',
            fetchTimeoutMs: 30000,
        });
        if (!chunk.includes('X-CSRF-TOKEN') || !chunk.includes('apiClient')) continue;

        const moduleSource = extractApiModule(chunk);
        if (!moduleSource) continue;
        return evaluateApiModule(moduleSource);
    }

    throw SIGNING_NOT_IMPL;
}

async function getApiClient() {
    if (!signerPromise) signerPromise = loadApiClient();
    return signerPromise;
}

async function buildSignedUrl(path, params = {}) {
    const apiClient = await getApiClient();
    let signedUrl = null;

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        signedUrl = url.toString();
        return {
            ok: true,
            headers: {
                get(name) {
                    return name.toLowerCase() === 'content-type'
                        ? 'application/json'
                        : null;
                },
            },
            async json() {
                return { status: 200, result: true };
            },
        };
    };

    try {
        await apiClient.get(path, { query: params });
    } finally {
        global.fetch = originalFetch;
    }

    if (!signedUrl) throw SIGNING_NOT_IMPL;
    return signedUrl;
}

async function signUrl(path, params = {}) {
    const next = signQueue.then(() => buildSignedUrl(path, params));
    signQueue = next.catch(() => {});
    return next;
}

async function signedFetch(path, params = {}, opts = {}) {
    const url = await signUrl(path, params);
    return unsignedFetch(url, opts);
}

/**
 * Helper for unsigned endpoints — plain GET + JSON parse. Used by parser
 * for /manga and /chapters/{id} which don't require signing.
 */
async function unsignedFetch(absoluteUrl, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        opts.fetchTimeoutMs || 30000
    );
    try {
        const res = await fetch(absoluteUrl, withProxy({
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
                'Referer': 'https://comix.to/',
                ...(opts.headers || {}),
            },
            signal: controller.signal,
        }));
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${absoluteUrl}`);
        return res.json();
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    signUrl,
    signedFetch,
    unsignedFetch,
    SIGNING_NOT_IMPL,
};
