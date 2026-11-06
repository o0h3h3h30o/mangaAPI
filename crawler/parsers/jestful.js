/**
 * Parser for jestful.net (2026 "modern" layout)
 *
 * The site switched from a classic Bootstrap theme to a new grid layout and
 * killed the old backend endpoints (/app/manga/controllers/*.lstc returns 404,
 * no more #chapter hidden input). Everything is now parsed from HTML directly.
 *
 * Homepage/list: /manga-list.html?page=N&sort=last_update&sort_type=DESC
 *   → article.manga-update-card × 24, chapters via a.update-chapter-link
 * Detail:         /hwms-{slug}.html
 *   → h1.manga-detail-title, .manga-detail-alt, .meta-row, a[href*=genre]
 *   → chapter list in .chapters-grid-container > a.chapter-card-item
 * Chapter reader: /bsaq-{slug}-chapter-N.html
 *   → img.reader-img[src]
 */
const cheerio = require('cheerio');

const BASE_URL = 'https://jestful.net';

// --------------- Parser Interface ---------------

const name = 'jestful';
const baseUrl = BASE_URL;
const DEFAULT_PAGES = 3;

function match(url) {
    return url.includes('jestful.net');
}

function getHomepageUrls(pages) {
    const count = pages || DEFAULT_PAGES;
    const urls = [];
    for (let page = 1; page <= count; page++) {
        urls.push(`${BASE_URL}/manga-list.html?page=${page}&sort=last_update&sort_type=DESC`);
    }
    return urls;
}

/**
 * Parse homepage HTML → array of manga items with recent chapters
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('article.manga-update-card').each((_, el) => {
        const $card = $(el);

        const $coverLink = $card.find('a.update-cover-link').first();
        const relUrl = $coverLink.attr('href') || '';
        if (!relUrl) return;

        const $img = $coverLink.find('img').first();
        // img[alt] holds the proper series name; fall back to <h2>
        const mangaName = ($img.attr('alt') || $card.find('h2').first().text() || '').trim();
        if (!mangaName) return;

        const coverUrl = resolveCoverUrl($img.attr('src') || '');

        // Latest chapters: text "◈ Ch. 108", href "/bsaq-{slug}-chapter-N.html".
        // Parse the number from the href — robust against stray dots in the
        // text (e.g. the dot in "Ch.") and any future label changes.
        const chapters = [];
        $card.find('a.update-chapter-link').each((_, chEl) => {
            const href = $(chEl).attr('href') || '';
            const m = href.match(/-chapter-(\d+(?:\.\d+)?)\.html/i);
            const number = m ? parseFloat(m[1]) : null;
            if (number !== null && isFinite(number)) {
                chapters.push({ number, url: buildFullUrl(href) });
            }
        });

        results.push({
            name: mangaName,
            url: buildFullUrl(relUrl),
            coverUrl,
            chapters,
            latestChapterNum: chapters.length > 0 ? chapters[0].number : 0,
        });
    });

    return results;
}

/**
 * Strict Japanese check: MUST contain hiragana or katakana (JP-only scripts).
 */
function isJapanese(text) {
    return /[぀-ゟ゠-ヿ]/.test(text);
}

function hasCjkIdeograph(text) {
    return /[一-龯㐀-䶿]/.test(text);
}

function extractJapanesePart(text) {
    const matches = text.match(/[　-〿぀-ゟ゠-ヿ一-龯㐀-䶿\s]+/g);
    if (!matches) return text;
    return matches.reduce((a, b) => a.length >= b.length ? a : b).trim();
}

/**
 * Parse detail page → manga info.
 * name = Japanese alt name when present (hiragana/katakana > kanji-only),
 *        otherwise the h1 series title.
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // Soft-404: jestful serves a themed error page with HTTP 200.
    const pageTitle = $('title').first().text().trim();
    if (/sorry.*(page\s+)?not\s+found|page\s+not\s+found|not\s+found|error\s*404/i.test(pageTitle)
        && $('h1.manga-detail-title').length === 0) {
        return { name: '', slugName: '', coverUrl: '', otherNames: '', genres: [], status: 'ongoing', authors: [], description: '' };
    }

    // Primary title from <h1>
    const h1Title = $('h1.manga-detail-title').first().text().trim();

    // Alternative names: <div class="manga-detail-alt"><b>Alternative:</b> ...</div>
    const altText = $('.manga-detail-alt').clone().find('b').remove().end().text().trim();
    const altNames = altText
        ? altText.split(/[,，/、]/).map(s => s.trim()).filter(Boolean)
        : [];

    // Pick JP name: hiragana/katakana first, kanji-only as weak fallback
    const jpName = altNames.find(isJapanese) || altNames.find(hasCjkIdeograph);
    const mangaName = jpName ? extractJapanesePart(jpName) : h1Title;

    // otherNames = all alt entries + h1 (dedup, keep order)
    const allNames = [...altNames];
    if (h1Title && !allNames.some(n => n.toLowerCase() === h1Title.toLowerCase())) {
        allNames.push(h1Title);
    }
    const otherNames = allNames.join(', ');

    // Cover: first img on the page that is NOT a related-manga thumbnail
    let coverUrl = '';
    $('img').each((_, el) => {
        const cls = $(el).attr('class') || '';
        if (cls.includes('related-cover-img')) return;
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (!src || src.startsWith('data:')) return;
        coverUrl = resolveCoverUrl(src);
        return false; // break
    });

    // Metadata from .meta-row: <b>Label:</b> value
    const meta = {};
    $('.meta-row').each((_, el) => {
        const label = $(el).find('b').first().text().trim().replace(/:$/, '').toLowerCase();
        const value = $(el).clone().find('b').remove().end().text().replace(/\s+/g, ' ').trim();
        if (label && value) meta[label] = value;
    });

    const authors = (meta.author || '').split(/[,/、]/).map(s => s.trim()).filter(Boolean);
    const artists = (meta.artist || '').split(/[,/、]/).map(s => s.trim()).filter(Boolean);

    // Status: "Ongoing" → "ongoing", "Completed" → "completed"
    const statusText = (meta.status || '').toLowerCase();
    const status = (statusText.includes('complete') && !statusText.includes('incomplete')) ? 'completed' : 'ongoing';

    // Genres: a[href*="genre="] or a[href*="genre-"] (dedupe)
    const genreSet = new Set();
    $('a[href*="genre"]').each((_, el) => {
        const t = $(el).text().trim();
        const href = $(el).attr('href') || '';
        if (t && /genre/i.test(href) && t.length < 40 && !/theme/i.test(href)) genreSet.add(t);
    });
    const genres = [...genreSet];

    // Description (defensive — not always present)
    let description = '';
    const $desc = $('[class*="summary"], [class*="description"], [class*="story"]').first();
    if ($desc.length) {
        const t = $desc.text().trim();
        if (t.length > 20 && t.length < 5000) description = t;
    }

    return {
        name: mangaName,
        slugName: h1Title,
        coverUrl,
        otherNames,
        genres,
        status,
        authors,
        artists,
        description,
    };
}

/**
 * Get full chapter list by parsing the detail page directly.
 * Each chapter is <a class="chapter-card-item ..."> in .chapters-grid-container.
 * Chapter number is extracted from the href (/bsaq-{slug}-chapter-N.html).
 */
async function getFullChapterList(mangaSourceUrl) {
    const { fetchPage } = require('./base');
    const html = await fetchPage(mangaSourceUrl);
    const $ = cheerio.load(html);

    const seen = new Set();
    const chapters = [];

    $('.chapters-grid-container a.chapter-card-item, a[href*="-chapter-"]').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        if (!/-chapter-[\d.]+\.html$/i.test(href)) return;
        // Skip the two buttons at top of detail page ("Read First Chapter" etc.)
        const cls = $a.attr('class') || '';
        if (/btn-primary-glow|btn-secondary-glow/.test(cls) && !/chapter-card-item|chapter-row/.test(cls)) return;

        const url = buildFullUrl(href);
        if (seen.has(url)) return;
        seen.add(url);

        const m = href.match(/-chapter-([\d.]+)\.html$/i);
        const number = m ? parseFloat(m[1]) : null;
        if (number === null || !isFinite(number)) return;

        // Try to find a sibling time element for created_at
        const timeText = $a.find('time, [class*="time"]').first().text().trim()
            || $a.parent().find('time, [class*="time"]').first().text().trim();
        const dt = parseRelativeTime(timeText);
        const createdAt = dt ? formatMysqlDatetime(dt) : null;

        chapters.push({ number, url, created_at: createdAt });
    });

    // De-dupe by number, keep the newer (first encountered in DOM is newest)
    const byNumber = new Map();
    for (const ch of chapters) if (!byNumber.has(ch.number)) byNumber.set(ch.number, ch);
    // Return oldest-first so the crawler's numbering is stable
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Get page images for a chapter — parse <img class="reader-img"> directly.
 */
async function getPageImages(chapterUrl) {
    const { fetchPage } = require('./base');
    const html = await fetchPage(chapterUrl);
    const $ = cheerio.load(html);

    const images = [];
    $('img.reader-img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src && src.startsWith('http')) images.push(src);
    });

    // Fallback: any <img> inside a reader container, if the class changes again
    if (images.length === 0) {
        $('.reader-content img, #reader img, [class*="reader"] img').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (src && src.startsWith('http')) images.push(src);
        });
    }

    return images;
}

// --------------- Internal Helpers ---------------

function buildFullUrl(relativePath) {
    if (!relativePath) return '';
    if (relativePath.startsWith('http')) return relativePath;
    return `${BASE_URL}/${relativePath.replace(/^\//, '')}`;
}

/**
 * Cover URLs come as "/app/manga/themes/modern/cover.php?u=<base64>&w=..."
 * where <base64> is the real CDN URL. Decode it so we save a direct URL
 * rather than one that depends on the jestful proxy staying up.
 */
function resolveCoverUrl(src) {
    if (!src) return '';
    const absolute = buildFullUrl(src);
    const m = absolute.match(/[?&]u=([A-Za-z0-9+/=_-]+)/);
    if (!m) return absolute;
    try {
        const decoded = Buffer.from(m[1], 'base64').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch { /* fall through */ }
    return absolute;
}

/**
 * Parse relative time ("14 minutes ago", "2 weeks ago", ...) → Date or null.
 */
function parseRelativeTime(text) {
    if (!text) return null;
    const str = text.toLowerCase().trim();

    if (/^(just now|a few seconds? ago)$/.test(str)) return new Date();

    const aMatch = str.match(/^(?:a|an)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    const nMatch = str.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/);
    const m = nMatch || aMatch;
    if (!m) return null;

    const n = nMatch ? parseInt(nMatch[1], 10) : 1;
    const unit = nMatch ? nMatch[2] : aMatch[1];
    const msPerUnit = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000,
    }[unit];
    return new Date(Date.now() - n * msPerUnit);
}

function formatMysqlDatetime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
