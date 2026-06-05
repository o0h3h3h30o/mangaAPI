/**
 * Shared utilities for all parsers
 */
const zlib = require('zlib');
const { withProxy } = require('../proxy');
const { slugify } = require('transliteration');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Decode a response body that may be compressed (gzip / brotli / deflate).
 *
 * Why this is more than "read the header": when fetch goes through an undici
 * ProxyAgent dispatcher, some Node versions (seen on v26) do NOT auto-decompress
 * the body, AND the proxy can strip the Content-Encoding header entirely. So we
 * may get raw brotli bytes with no header at all. Strategy:
 *   1. If it already looks like text (<, {, [) → return as-is.
 *   2. Otherwise try the declared codec first, then sniff every codec — proxies
 *      lie/strip headers, so we just attempt each until one yields output.
 *   3. Give up → return raw bytes as utf8.
 */
function decodeBody(buf, encoding) {
    if (!buf || buf.length === 0) return '';

    // Already plain text (undici decompressed it, or server sent uncompressed)
    const head = buf.subarray(0, 8).toString('latin1').replace(/^\s+/, '');
    if (head.startsWith('<') || head.startsWith('{') || head.startsWith('[')) {
        return buf.toString('utf8');
    }

    const enc = (encoding || '').toLowerCase();
    const codecs = [];
    if (enc.includes('br')) codecs.push(zlib.brotliDecompressSync);
    if (enc.includes('gzip')) codecs.push(zlib.gunzipSync);
    if (enc.includes('deflate')) codecs.push(zlib.inflateSync);
    // Fallbacks — covers a stripped or wrong Content-Encoding header
    codecs.push(zlib.brotliDecompressSync, zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync);

    for (const fn of codecs) {
        try {
            const out = fn(buf);
            if (out && out.length) return out.toString('utf8');
        } catch {
            // try next codec
        }
    }
    return buf.toString('utf8');
}

async function fetchPage(url) {
    const referer = new URL(url).origin;
    // Ask for compression explicitly; undici then leaves decoding to us, so the
    // behaviour is identical across Node versions (with or without proxy).
    const res = await fetch(url, withProxy({
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': referer,
            'Accept-Encoding': 'gzip, deflate, br',
        },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return decodeBody(buf, res.headers.get('content-encoding'));
}

function generateSlug(name) {
    return slugify(name, { lowercase: true, separator: '-' });
}

function generateChapterSlug(number) {
    return `chapter-${String(number).replace('.', '-')}`;
}

function parseChapterNumber(text) {
    if (!text) return null;
    const match = text.match(/(?:ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i);
    return match ? parseFloat(match[1]) : null;
}

module.exports = {
    USER_AGENT,
    fetchPage,
    generateSlug,
    generateChapterSlug,
    parseChapterNumber,
};
