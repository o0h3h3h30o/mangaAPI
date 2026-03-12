/**
 * Parser for raw18.info (Japanese manga - フルカラー/Full-color)
 *
 * NOTE: Site thường xuyên đổi tên miền.
 *       Luôn dùng --source raw18 để chỉ định parser này.
 *
 * Homepage: /search/manga?genre=フルカラー&page=N
 * Detail:   /manga/{slug}
 * Chapter:  /manga/{slug}/chapter-{n}
 * Images:   div.reading-detail img[src] (CDN, direct load)
 *
 * === Cấu trúc HTML (đã phân tích) ===
 * Homepage card: <figure class="clearfix">
 *   Cover:    div.image img[data-original]
 *   Name:     div.image a[title]
 *   URL:      div.image a[href]
 *   Chapters: ul.comic-item li.chapter a[href]
 *
 * Detail page: ul.list-info
 *   Authors:  li.author.row p.col-xs-8
 *   Status:   li.row.status p.col-xs-8  (連載中 | 完結)
 *   Genres:   a[href*="genre="]
 * Chapter list: .list-chapter nav ul li div.chapter a
 * Chapter imgs: div.reading-detail img[src]
 */
const cheerio = require('cheerio');
const { withProxy } = require('../proxy');
const { USER_AGENT } = require('./base');

const BASE_URL = 'https://raw18.rest';
const DEFAULT_PAGES = 3;

// フルカラー genre (URL-encoded)
const GENRE_PATH = '/search/manga?genre=%E3%83%95%E3%83%AB%E3%82%AB%E3%83%A9%E3%83%BC';

// --------------- Parser Interface ---------------

const name = 'raw18';
const baseUrl = BASE_URL;

/**
 * Match URLs belonging to raw18 (update this if domain changes)
 */
function match(url) {
    return url.includes('raw18.info') || url.includes('raw18.link') || url.includes('raw18.rest');
}

/**
 * Get homepage URLs to crawl (genre=フルカラー, paginated)
 */
function getHomepageUrls(pages, _customUrl, startPage) {
    const count = pages || DEFAULT_PAGES;
    const start = startPage || 1;
    const urls = [];
    for (let page = start; page < start + count; page++) {
        urls.push(`${BASE_URL}${GENRE_PATH}&page=${page}`);
    }
    return urls;
}

/**
 * Parse homepage HTML → array of manga items
 *
 * Each card is: <figure class="clearfix">
 *   div.image > a[href, title] > img[data-original]
 *   figcaption > ul.comic-item > li.chapter > a[href]
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('figure.clearfix').each((_, el) => {
        const $card = $(el);

        // URL and name from div.image > a
        const $imageLink = $card.find('div.image > a').first();
        const href = $imageLink.attr('href') || '';
        if (!href.includes('/manga/')) return;

        const url = buildFullUrl(href);
        const mangaName = ($imageLink.attr('title') || '').trim();
        if (!mangaName) return;

        // Cover: data-original (lazy) with src fallback
        const $img = $card.find('div.image img').first();
        const coverUrl = ($img.attr('data-original') || $img.attr('src') || '').trim();

        // Latest chapters from ul.comic-item li.chapter a
        const chapters = [];
        $card.find('ul.comic-item li.chapter a').each((_, chEl) => {
            const chHref = $(chEl).attr('href') || '';
            const chNum = extractChapterNumber(chHref, $(chEl).text().trim());
            if (chNum !== null) {
                chapters.push({ number: chNum, url: buildFullUrl(chHref) });
            }
        });

        results.push({
            name: mangaName,
            url,
            coverUrl,
            chapters,
            latestChapterNum: chapters.length > 0
                ? Math.max(...chapters.map(c => c.number))
                : 0,
        });
    });

    return results;
}

/**
 * Parse manga detail page → extract manga info
 *
 * Info panel: ul.list-info
 *   li.author.row p.col-xs-8   → authors
 *   li.row.status p.col-xs-8   → 連載中 | 完結
 *   a[href*="genre="]          → genres
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // Title
    const mangaName = $('h1').first().text().trim();

    // Cover: main cover uses src (not lazy-loaded), inside div.detail-info or div.col-image.
    // Sidebar/recommendations use data-original (lazy) → must NOT use those.
    const coverUrl = ($('div.detail-info img[src*="admin.raw18"]').first().attr('src')
        || $('div.col-image img[src]').first().attr('src')
        || $('img[src*="admin.raw18"]').first().attr('src') || '').trim();

    // SlugName from cover URL
    const slugFromCover = coverUrl.match(/storage\/images\/([^\/]+)\//);
    const slugName = slugFromCover ? slugFromCover[1] : mangaName;

    // Authors from li.author.row p.col-xs-8
    const authors = [];
    const authorText = $('li.author.row p.col-xs-8').first().text().trim();
    if (authorText) {
        authorText.split(/[,、，]/).forEach(a => {
            const t = a.trim();
            if (t) authors.push(t);
        });
    }

    // Status: 連載中 → ongoing, 完結 → completed
    const statusText = $('li.row.status p.col-xs-8').first().text().trim();
    const status = /完結/.test(statusText) ? 'completed' : 'ongoing';

    // Genres: deduplicate by text
    const genres = [];
    $('a[href*="genre="]').each((_, el) => {
        const genre = $(el).text().trim();
        if (genre && !genres.includes(genre)) genres.push(genre);
    });

    // Description from meta tags
    const description = $('meta[name="description"]').attr('content')
        || $('meta[property="og:description"]').attr('content') || '';

    // Alternative names: li.row p.col-xs-8 near 代替名 label
    let otherNames = '';
    $('ul.list-info li.row').each((_, el) => {
        const $li = $(el);
        const label = $li.find('p').first().text().trim();
        if (/代替名/.test(label)) {
            otherNames = $li.find('p.col-xs-8').text().trim();
        }
    });

    return {
        name: mangaName,
        slugName,
        coverUrl,
        otherNames,
        genres,
        status,
        authors,
        description,
    };
}

/**
 * Get full chapter list from manga detail page
 * Selector: .list-chapter nav ul li div.chapter a
 * Returns chapters sorted ascending by number
 */
async function getFullChapterList(mangaSourceUrl) {
    const html = await fetchWithReferer(mangaSourceUrl, BASE_URL);
    const $ = cheerio.load(html);
    const chapters = [];
    const seen = new Set();

    // Extract slug to filter only chapters belonging to this manga
    const slugMatch = mangaSourceUrl.match(/\/manga\/([^\/\?#]+)/);
    const mangaSlug = slugMatch ? slugMatch[1] : '';

    $('.list-chapter nav ul li').each((_, el) => {
        const $a = $(el).find('div.chapter a').first();
        const href = $a.attr('href') || '';
        if (!href) return;

        // Only include chapters of this manga
        if (mangaSlug && !href.includes(`/manga/${mangaSlug}/`)) return;
        if (seen.has(href)) return;
        seen.add(href);

        const chNum = extractChapterNumber(href, $a.text().trim());
        if (chNum === null) return;

        const title = $a.attr('title') || $a.text().trim() || `第${chNum}話`;

        chapters.push({
            number: chNum,
            title,
            url: buildFullUrl(href),
        });
    });

    // Site lists newest first → reverse to ascending
    chapters.sort((a, b) => a.number - b.number);
    return chapters;
}

/**
 * Get page images for a chapter
 *
 * Images are inside div.reading-detail and loaded directly (no JS lazy load).
 * CDN: zr8photomg.online (may change with domain)
 * Filter: exclude logo/UI images from raw18.info domain.
 */
async function getPageImages(chapterUrl) {
    // Referer = manga detail page (strip chapter suffix)
    const referer = chapterUrl.replace(/\/chapter-[^\/]+$/, '') || BASE_URL;
    const html = await fetchWithReferer(chapterUrl, referer);
    const $ = cheerio.load(html);

    const images = [];

    $('div.reading-detail img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-original') || '';
        if (!src) return;
        // Exclude site's own logo/UI assets
        if (src.includes('raw18.info') || src.includes('raw18.link') || src.includes('raw18.rest')) return;
        images.push(src);
    });

    return images;
}

// --------------- Internal Helpers ---------------

/**
 * Normalize URL: replace old domain with current BASE_URL
 * raw18.info / raw18.link → raw18.rest (transparent to DB stored URLs)
 */
function normalizeUrl(url) {
    if (!url) return url;
    return url.replace(/https?:\/\/(?:www\.)?raw18\.(?:info|link)/, BASE_URL);
}

/**
 * Fetch a page with proper Referer + User-Agent headers (+ proxy rotation)
 */
async function fetchWithReferer(url, referer) {
    url = normalizeUrl(url);
    referer = normalizeUrl(referer);
    const res = await fetch(url, withProxy({
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': referer || BASE_URL,
        },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

/**
 * Extract chapter number from chapter URL or Japanese title text
 *
 * URL:  /chapter-79       → 79
 *       /chapter-79-5     → 79.5  (decimal with dash separator)
 * Text: 第79話            → 79
 */
function extractChapterNumber(href, text) {
    const urlMatch = href.match(/chapter-(\d+)(?:-(\d+))?/i);
    if (urlMatch) {
        const major = parseInt(urlMatch[1], 10);
        const minor = urlMatch[2] ? parseInt(urlMatch[2], 10) : null;
        return minor !== null ? parseFloat(`${major}.${minor}`) : major;
    }
    const jpMatch = text && text.match(/第(\d+(?:\.\d+)?)話/);
    if (jpMatch) return parseFloat(jpMatch[1]);
    return null;
}

function buildFullUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `${BASE_URL}/${path.replace(/^\//, '')}`;
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
