/**
 * Parser for jestful.net
 * Extracts manga and chapter data from homepage and detail pages
 */
const cheerio = require('cheerio');
const { parseChapterNumber } = require('./base');

const BASE_URL = 'https://jestful.net';

// --------------- Parser Interface ---------------

const name = 'jestful';
const baseUrl = BASE_URL;

function match(url) {
    return url.includes('jestful.net');
}

/**
 * Parse homepage HTML → array of manga items with recent chapters
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.itemupdate').each((_, el) => {
        const $item = $(el);

        const name = $item.find('h3.title-h3').text().trim();
        if (!name) return;

        const relativeUrl = $item.find('a.title-h3-link').attr('href') || '';
        const url = buildFullUrl(relativeUrl);

        const coverUrl = $item.find('a.cover img').attr('data-src')
            || $item.find('a.cover img').attr('src')
            || '';

        // Chapters from homepage (usually 3 most recent)
        const chapters = [];
        $item.find('a.chapter').each((_, chEl) => {
            const $ch = $(chEl);
            const title = $ch.attr('title') || '';
            const chapterRelUrl = $ch.attr('href') || '';
            const chText = $ch.text().trim();
            const number = parseChapterNumber(chText);

            if (number !== null) {
                chapters.push({
                    number,
                    title,
                    url: buildFullUrl(chapterRelUrl),
                });
            }
        });

        results.push({
            name,
            url,
            coverUrl,
            chapters,
            latestChapterNum: chapters.length > 0 ? chapters[0].number : 0,
        });
    });

    return results;
}

/**
 * Check if text contains Japanese characters (Kanji, Hiragana, Katakana)
 */
function isJapanese(text) {
    return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
}

/**
 * Extract the Japanese portion from a mixed string
 * "Shanbaraddo シャンバラッド" → "シャンバラッド"
 * "公式不倫" → "公式不倫"
 */
function extractJapanesePart(text) {
    // Match consecutive Japanese characters (+ spaces between them)
    const matches = text.match(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf\s]+/g);
    if (!matches) return text;
    // Return the longest Japanese segment, trimmed
    return matches.reduce((a, b) => a.length >= b.length ? a : b).trim();
}

/**
 * Parse manga detail page → extract manga info
 * name = Japanese name (from otherNames), otherNames = all names combined
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // Title from h3 (usually romaji/english)
    const h3Title = $('ul.manga-info h3').first().text().trim();

    // Cover image
    const coverUrl = $('.info-cover img.thumbnail').attr('src') || '';

    // Raw other names from page
    let rawOtherNames = '';
    $('ul.manga-info li').each((_, el) => {
        const text = $(el).text();
        if (text.includes('Other name')) {
            rawOtherNames = text.replace(/.*Other name\s*\(s\)\s*:\s*/i, '').trim();
        }
    });

    // Split other names and find Japanese name
    const altNames = rawOtherNames
        ? rawOtherNames.split(/,\s*/).map(n => n.trim()).filter(Boolean)
        : [];
    const jpName = altNames.find(n => isJapanese(n));

    // name = Japanese portion extracted from JP entry, fallback to h3 title
    const mangaName = jpName ? extractJapanesePart(jpName) : h3Title;

    // otherNames = all unique names combined (JP names, EN names, h3 title)
    const allNames = [...altNames];
    if (h3Title && !allNames.some(n => n.toLowerCase() === h3Title.toLowerCase())) {
        allNames.push(h3Title);
    }
    const otherNames = allNames.join(', ');

    // Genres
    const genres = [];
    $('ul.manga-info li').each((_, el) => {
        const text = $(el).text();
        if (text.includes('Genre(s)')) {
            $(el).find('a.btn').each((_, a) => {
                const genre = $(a).text().trim();
                if (genre) genres.push(genre);
            });
        }
    });

    // Status: "Incomplete" → "ongoing", "Completed" → "completed"
    let status = 'ongoing';
    $('ul.manga-info li').each((_, el) => {
        const text = $(el).text();
        if (text.includes('Status')) {
            const statusText = $(el).find('a.btn').text().trim().toLowerCase();
            if (statusText.includes('complete') && !statusText.includes('incomplete')) {
                status = 'completed';
            }
        }
    });

    // Authors (often commented out in HTML, try regex on raw HTML)
    const authors = [];
    const authorMatch = html.match(/manga-author-(.*?)\.html/g);
    if (authorMatch) {
        authorMatch.forEach(m => {
            const authorName = m.replace('manga-author-', '').replace('.html', '');
            if (authorName && !authors.includes(authorName)) authors.push(authorName);
        });
    }

    // Description
    let description = '';
    $('div.row').each((_, el) => {
        const $row = $(el);
        const h3 = $row.find('h3').first().text().trim();
        if (h3 === 'Description') {
            description = $row.find('p').first().text().trim();
        }
    });

    return { name: mangaName, coverUrl, otherNames, genres, status, authors, description };
}

/**
 * Get full chapter list for a manga by its source URL
 */
async function getFullChapterList(mangaSourceUrl) {
    const slug = extractSlugFromUrl(mangaSourceUrl);
    if (!slug) throw new Error(`Cannot extract slug from: ${mangaSourceUrl}`);

    const html = await fetchChapterList(slug);
    return parseChapterListResponse(html);
}

// --------------- Internal Helpers ---------------

function buildFullUrl(relativePath) {
    if (!relativePath) return '';
    if (relativePath.startsWith('http')) return relativePath;
    return `${BASE_URL}/${relativePath.replace(/^\//, '')}`;
}

function extractSlugFromUrl(url) {
    const match = url.match(/hwms-(.*?)\.html/);
    return match ? match[1] : null;
}

function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function fetchChapterList(mangaSlug) {
    const randomStr = generateRandomString(25);
    const url = `${BASE_URL}/app/manga/controllers/${randomStr}.lstc?slug=${mangaSlug}`;

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'http://jestful.net',
        },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching chapter list for ${mangaSlug}`);
    return res.text();
}

function parseChapterListResponse(html) {
    const $ = cheerio.load(html);
    const chapters = [];

    $('tbody tr').each((_, el) => {
        const $row = $(el);
        const $a = $row.find('a').first();
        if (!$a.length) return;

        const href = $a.attr('href') || '';
        const chName = $a.text().trim();
        const number = parseChapterNumber(chName);
        const timeText = $row.find('time').text().trim();

        if (number !== null) {
            chapters.push({
                number,
                title: chName,
                url: buildFullUrl(href),
                created_at: timeText || null,
            });
        }
    });

    return chapters;
}

// --------------- Export ---------------

module.exports = {
    name,
    baseUrl,
    match,
    parseHomepage,
    extractMangaInfo,
    getFullChapterList,
};
