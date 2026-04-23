/**
 * Comix.to API URL signing module — STUB
 *
 * Some endpoints on comix.to API (notably /manga/{hash}/chapters) return
 *   HTTP 403 { status: 403, message: "Unable to read the request." }
 * unless the request carries a valid signature. The signing scheme is
 * implemented client-side inside the Next.js bundle shipped by comix.to
 * and is not provided by this stub.
 *
 * To enable chapter crawling for the comix parser, replace this file with
 * the real signing implementation. The expected API is:
 *
 *   async function signUrl(path: string, params?: object): Promise<string>
 *     Returns the fully qualified, signed URL ready for fetch().
 *
 *   async function signedFetch<T>(
 *     path: string,
 *     params?: object,
 *     opts?: { fetchTimeoutMs?: number, headers?: object }
 *   ): Promise<T>
 *     Performs the signed GET request and returns parsed JSON.
 *
 * Until the real module lands, calls fall through to `SIGNING_NOT_IMPL`
 * and the parser logs a clear hint instead of crashing silently.
 */
const { withProxy } = require('../proxy');
const { USER_AGENT } = require('./base');

const SIGNING_NOT_IMPL = new Error(
    'comix signing not implemented — replace crawler/parsers/comix-sign.js ' +
    'with the real signing module to enable /manga/{hash}/chapters crawling.'
);

async function signUrl(_path, _params = {}) {
    throw SIGNING_NOT_IMPL;
}

async function signedFetch(_path, _params = {}, _opts = {}) {
    throw SIGNING_NOT_IMPL;
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
