/**
 * Parser for jestful.net
 * Extracts manga and chapter data from homepage and detail pages
 */
const cheerio = require('cheerio');

const BASE_URL = 'https://jestful.net';

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
 * Extract manga slug from URL: "hwms-shamballad.html" → "shamballad"
 */
function extractSlugFromUrl(url) {
    const match = url.match(/hwms-(.*?)\.html/);
    return match ? match[1] : null;
}

/**
 * Generate random string (like PHP's generateRandomString)
 */
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Fetch full chapter list via jestful API
 * URL: /app/manga/controllers/{random25}.lstc?slug={mangaSlug}
 * Returns HTML table with chapters
 */
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

/**
 * Parse chapter list API response (HTML table)
 * Each row: <tr> <a href="...">Chapter X</a> <time>...</time> </tr>
 */
function parseChapterListResponse(html) {
    const $ = cheerio.load(html);
    const chapters = [];

    $('tbody tr').each((_, el) => {
        const $row = $(el);
        const $a = $row.find('a').first();
        if (!$a.length) return;

        const href = $a.attr('href') || '';
        const name = $a.text().trim();
        const number = parseChapterNumber(name);
        const timeText = $row.find('time').text().trim();

        if (number !== null) {
            chapters.push({
                number,
                title: name,
                url: buildFullUrl(href),
                created_at: timeText || null,
            });
        }
    });

    return chapters;
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

/**
 * Extract chapter number from text like "◈ Ch. 4.1" or "Chapter 73"
 */
function parseChapterNumber(text) {
    if (!text) return null;
    const match = text.match(/(?:ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i);
    return match ? parseFloat(match[1]) : null;
}

/**
 * Generate slug from manga name
 */
function generateSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Generate chapter slug from number: 4.1 → "chapter-4-1"
 */
function generateChapterSlug(number) {
    return `chapter-${String(number).replace('.', '-')}`;
}

/**
 * Build full URL from relative path
 */
function buildFullUrl(relativePath) {
    if (!relativePath) return '';
    if (relativePath.startsWith('http')) return relativePath;
    return `${BASE_URL}/${relativePath.replace(/^\//, '')}`;
}

module.exports = {
    BASE_URL,
    parseHomepage,
    parseChapterListResponse,
    fetchChapterList,
    getFullChapterList,
    extractSlugFromUrl,
    parseChapterNumber,
    generateSlug,
    generateChapterSlug,
    buildFullUrl,
};
