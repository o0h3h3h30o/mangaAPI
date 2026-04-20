/**
 * Parser for jestful.net
 * Extracts manga and chapter data from homepage and detail pages
 */
const cheerio = require('cheerio');
const { parseChapterNumber } = require('./base');
const { withProxy } = require('../proxy');

const BASE_URL = 'https://jestful.net';

// --------------- Parser Interface ---------------

const name = 'jestful';
const baseUrl = BASE_URL;
const DEFAULT_PAGES = 3;

function match(url) {
    return url.includes('jestful.net');
}

/**
 * Get homepage URLs to crawl (paginated)
 * @param {number} [pages] - override number of pages (default: 3)
 */
function getHomepageUrls(pages) {
    const count = pages || DEFAULT_PAGES;
    const urls = [];
    for (let page = 1; page <= count; page++) {
        urls.push(`${BASE_URL}/manga-list.html?listType=pagination&page=${page}&sort=last_update&sort_type=DESC`);
    }
    return urls;
}

/**
 * Parse homepage HTML → array of manga items with recent chapters
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.thumb-item-flow').each((_, el) => {
        const $item = $(el);

        const name = $item.find('h3.title-thumb').text().trim();
        if (!name) return;

        // Manga URL from series-title link (href starts with "hwms-")
        const relativeUrl = $item.find('.series-title a').attr('href') || '';
        const url = buildFullUrl(relativeUrl);

        // Cover from data-bg attribute on .img-in-ratio
        const coverUrl = $item.find('.img-in-ratio').attr('data-bg') || '';

        // Chapter from "Last chapter: X" button
        const chapters = [];
        $item.find('a.btn-danger').each((_, chEl) => {
            const $ch = $(chEl);
            const chapterRelUrl = $ch.attr('href') || '';
            const chText = $ch.text().trim(); // "Last chapter: 4.1"
            // Extract number from "Last chapter: X" format
            const match = chText.match(/([\d.]+)\s*$/);
            const number = match ? parseFloat(match[1]) : null;

            if (number !== null) {
                chapters.push({
                    number,
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
 * Strict Japanese check: MUST contain hiragana or katakana.
 * These two syllabaries exist only in Japanese, so they distinguish
 * JP from Chinese (which shares the CJK kanji range \u4e00-\u9faf).
 */
function isJapanese(text) {
    return /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
}

/**
 * Weak fallback: contains any CJK ideograph (kanji) — could be Japanese
 * or Chinese. Use only when no hiragana/katakana candidate exists.
 */
function hasCjkIdeograph(text) {
    return /[\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
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

    // Cover image (may be relative, build full URL)
    const rawCoverUrl = $('.info-cover img.thumbnail').attr('src') || '';
    const coverUrl = buildFullUrl(rawCoverUrl);

    // Raw other names from page
    let rawOtherNames = '';
    $('ul.manga-info li').each((_, el) => {
        const text = $(el).text();
        if (text.includes('Other name')) {
            rawOtherNames = text.replace(/.*Other name\s*\(s\)\s*:\s*/i, '').trim();
        }
    });

    // Split other names and find Japanese name.
    // Priority:
    //   1. Entry with hiragana/katakana → definitely Japanese
    //   2. Entry with only CJK ideographs (kanji-only) → could be JP or CN,
    //      used as weak fallback only if no stronger candidate exists
    const altNames = rawOtherNames
        ? rawOtherNames.split(/,\s*/).map(n => n.trim()).filter(Boolean)
        : [];
    const jpName = altNames.find(isJapanese)
                || altNames.find(hasCjkIdeograph);

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

    return { name: mangaName, slugName: h3Title, coverUrl, otherNames, genres, status, authors, description };
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

    const res = await fetch(url, withProxy({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'http://jestful.net',
        },
    }));

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching chapter list for ${mangaSlug}`);
    return res.text();
}

/**
 * Parse relative time strings từ jestful: "14 minutes ago", "2 weeks ago", "1 months ago"...
 * → Date object. Returns null nếu không parse được.
 */
function parseRelativeTime(text) {
    if (!text) return null;
    const str = text.toLowerCase().trim();

    // "just now" / "a few seconds ago"
    if (/^(just now|a few seconds? ago)$/.test(str)) {
        return new Date();
    }

    // "a minute ago" / "an hour ago" / "a day ago"...
    const aMatch = str.match(/^(?:a|an)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    // "14 minutes ago" / "2 weeks ago" / "1 months ago"
    const nMatch = str.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/);

    const m = nMatch || aMatch;
    if (!m) return null;

    const n = nMatch ? parseInt(nMatch[1], 10) : 1;
    const unit = (nMatch ? nMatch[2] : aMatch[1]);

    const msPerUnit = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,   // xấp xỉ
        year: 365 * 24 * 60 * 60 * 1000,   // xấp xỉ
    }[unit];

    return new Date(Date.now() - n * msPerUnit);
}

/**
 * Format Date → "YYYY-MM-DD HH:MM:SS" (MySQL DATETIME, local timezone)
 */
function formatMysqlDatetime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

        // Convert relative time ("2 weeks ago") → MySQL DATETIME
        const dt = parseRelativeTime(timeText);
        const createdAt = dt ? formatMysqlDatetime(dt) : null;

        if (number !== null) {
            chapters.push({
                number,
                url: buildFullUrl(href),
                created_at: createdAt,
            });
        }
    });

    return chapters;
}

/**
 * Get page images for a chapter
 * 1. Fetch chapter page → extract chapter_id from #chapter input
 * 2. Call image API: /app/manga/controllers/{random30}iog?cid={chapter_id}
 * 3. Parse response: p img → image URLs
 */
async function getPageImages(chapterUrl) {
    const { fetchPage } = require('./base');

    // Step 1: Fetch chapter page, extract chapter_id
    const html = await fetchPage(chapterUrl);
    const $ = cheerio.load(html);
    const chapterId = $('#chapter').attr('value') || $('#chapter').val();
    if (!chapterId) throw new Error(`Cannot find #chapter value from: ${chapterUrl}`);

    // Step 2: Call image API
    const randomStr = generateRandomString(30);
    const apiUrl = `${BASE_URL}/app/manga/controllers/${randomStr}iog?cid=${chapterId}`;

    const res = await fetch(apiUrl, withProxy({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'https://jestful.net',
        },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching page images for cid=${chapterId}`);
    const imgHtml = await res.text();

    // Step 3: Parse p img → image URLs
    const $img = cheerio.load(imgHtml);
    const images = [];
    $img('p img').each((_, el) => {
        const src = $img(el).attr('src') || $img(el).attr('data-src') || '';
        if (src) images.push(src);
    });

    return images;
}

// --------------- Export ---------------

module.exports = {
    name,
    baseUrl,
    match,
    getHomepageUrls,
    parseHomepage,
    extractMangaInfo,
    getFullChapterList,
    getPageImages,
};
