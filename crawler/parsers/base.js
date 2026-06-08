/**
 * Shared utilities for all parsers
 */
const zlib = require('zlib');
const { withProxy } = require('../proxy');
const { slugify } = require('transliteration');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Heuristic: does this buffer look like plain (uncompressed) text?
 *
 * We can't trust the first byte — compressed (brotli) data can start with any
 * byte, including '<', '{' or '[' by coincidence (this actually bit us). Instead
 * we sample the head and measure the ratio of NUL/control bytes: real HTML is
 * almost all printable, compressed bytes are full of control characters.
 */
function isProbablyText(buf) {
    const n = Math.min(buf.length, 1024);
    if (n === 0) return true;
    let suspicious = 0;
    for (let i = 0; i < n; i++) {
        const b = buf[i];
        // Allow tab(9), LF(10), CR(13) and any printable byte (>= 32).
        if (b === 0 || (b < 9) || (b > 13 && b < 32)) suspicious++;
    }
    return suspicious / n < 0.02;
}

/**
 * Decode a response body that may be compressed (gzip / brotli / deflate).
 *
 * Why this is more than "read the header": through an undici ProxyAgent
 * dispatcher, some Node versions (seen on v26) do NOT auto-decompress the body
 * AND the proxy can strip the Content-Encoding header entirely — so we may get
 * raw brotli bytes with no header at all. Strategy:
 *   1. If the header declares a codec, try it first.
 *   2. If the bytes already look like text, return as-is.
 *   3. Header stripped → sniff every codec until one yields output.
 */
function decodeBody(buf, encoding) {
    if (!buf || buf.length === 0) return '';

    const enc = (encoding || '').toLowerCase();
    const tryDecode = (fn) => {
        try {
            const out = fn(buf);
            if (out && out.length) return out.toString('utf8');
        } catch { /* not this codec */ }
        return null;
    };

    // 1. Honour an explicit Content-Encoding header
    if (enc.includes('br')) { const r = tryDecode(zlib.brotliDecompressSync); if (r) return r; }
    if (enc.includes('gzip')) { const r = tryDecode(zlib.gunzipSync); if (r) return r; }
    if (enc.includes('deflate')) { const r = tryDecode(zlib.inflateSync); if (r) return r; }

    // 2. Already plain text (undici decompressed it, or server sent it raw)
    if (isProbablyText(buf)) return buf.toString('utf8');

    // 3. Header stripped/wrong → sniff every codec
    for (const fn of [zlib.brotliDecompressSync, zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync]) {
        const r = tryDecode(fn);
        if (r) return r;
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
