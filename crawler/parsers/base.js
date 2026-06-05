/**
 * Shared utilities for all parsers
 */
const zlib = require('zlib');
const { withProxy } = require('../proxy');
const { slugify } = require('transliteration');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Manually decompress a response body by Content-Encoding.
 *
 * Why: when fetch goes through an undici ProxyAgent dispatcher, some Node
 * versions do NOT auto-decompress gzip/br/deflate responses, so res.text()
 * returns raw compressed bytes (garbage). We read the bytes ourselves and
 * decode based on the header. If the body is already plain (undici did
 * decompress, or no encoding), decompression throws and we fall back to the
 * raw buffer — so this is safe in every case.
 */
function decodeBody(buf, encoding) {
    const enc = (encoding || '').toLowerCase();
    try {
        if (enc.includes('br')) return zlib.brotliDecompressSync(buf).toString('utf8');
        if (enc.includes('gzip')) return zlib.gunzipSync(buf).toString('utf8');
        if (enc.includes('deflate')) return zlib.inflateSync(buf).toString('utf8');
    } catch {
        // Already-decompressed body (undici handled it) → fall through to raw
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
