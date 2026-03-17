/**
 * Shared utilities for all parsers
 */
const { withProxy } = require('../proxy');
const { slugify } = require('transliteration');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchPage(url) {
    const referer = new URL(url).origin;
    const res = await fetch(url, withProxy({
        headers: { 'User-Agent': USER_AGENT, 'Referer': referer },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
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
