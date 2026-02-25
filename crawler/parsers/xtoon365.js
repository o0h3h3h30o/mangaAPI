/**
 * Parser for xtoon365.com (Korean webtoon)
 *
 * Homepage (ajax): /category/theme/302/finish/2/page/{n}?ajax=1
 * Detail page:     /comic/{id}
 * Chapter page:    /chapter/{id}   → img.lazy-read[data-original]
 */
const cheerio = require('cheerio');

const BASE_URL = 'https://t1.xtoon365.com';
const DEFAULT_PAGES = 3;

// --------------- Parser Interface ---------------

const name = 'xtoon365';
const baseUrl = BASE_URL;

function match(url) {
    return url.includes('xtoon365.com') || url.includes('xtoon33.com');
}

/**
 * Homepage URLs (ajax paginated)
 *
 * Supports custom category URLs:
 *   --url https://t1.xtoon365.com/category/theme/302/finish/1   (ongoing)
 *   --url https://t1.xtoon365.com/category/theme/302/finish/2   (completed)
 *   --url https://t1.xtoon365.com/category/theme/302             (all)
 *
 * Default: theme/302 (all)
 */
function getHomepageUrls(pages, customUrl, startPage) {
    const count = pages || DEFAULT_PAGES;
    const start = startPage || 1;

    let basePath = '/category/theme/302';

    const urls = [];
    for (let page = start; page < start + count; page++) {
        urls.push(`${BASE_URL}${basePath}/page/${page}?ajax=1`);
    }
    return urls;
}

/**
 * Parse homepage ajax HTML → array of manga items
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.katoon-box').each((_, el) => {
        const $item = $(el);

        const $a = $item.find('a.img-box');
        const href = $a.attr('href') || '';
        // /comic/847551 → 847551
        const comicId = href.replace(/.*\/comic\//, '');
        if (!comicId) return;

        const mangaName = $item.find('h6').first().contents().first().text().trim();
        if (!mangaName) return;

        const coverUrl = $item.find('img.lazy').attr('data-original') || '';

        // Latest chapter text: "30화 - 최종화", "특별 외전 6화 [최종화]"
        const chapterText = $item.find('small.text-black').first().text().trim();
        const chapterNum = parseKoreanChapterNumber(chapterText);

        const url = `${BASE_URL}/comic/${comicId}`;

        results.push({
            name: mangaName,
            url,
            coverUrl,
            chapters: chapterNum ? [{ number: chapterNum, url }] : [],
            latestChapterNum: chapterNum || 0,
            latestChapterText: chapterText || '',
        });
    });

    return results;
}

/**
 * Parse Korean chapter text → number
 *
 * Patterns:
 *   "30화"                    → 30
 *   "성인 독서회 34화 [최종화]" → 34
 *   "외전 7화"                → 7       (side story with number)
 *   "외전1"                   → 1       (외전 + number, no 화)
 *   "0054 - 54화"             → 54
 *   "0056 - 후기"             → 56      (leading number, no 화)
 *   "[특별편]"                → null    (special, no number)
 *   "[후기]"                  → null
 */
function parseKoreanChapterNumber(text) {
    if (!text) return null;

    // Side stories / specials → null (let gap numbering handle them)
    // "특별 외전 5화", "만져도 돼? 외전 1화"
    if (/외전|특별/.test(text)) return null;

    // Pattern 1: 숫자화 (most common) — "13화", "성인 독서회 34화"
    const hwMatch = text.match(/(\d+)\s*화/);
    if (hwMatch) return parseInt(hwMatch[1], 10);

    // Pattern 2: leading number — "0056 - 후기", "0055 - 마지막화"
    const leadMatch = text.match(/^(\d{2,})\s*[-–]/);
    if (leadMatch) return parseInt(leadMatch[1], 10);

    return null;
}

/**
 * Extract manga info from detail page HTML
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // Title
    const mangaName = $('h4.fw-bold').first().contents().first().text().trim();

    // Cover
    const coverUrl = $('.toon-img img').attr('src') || '';

    // Author (small under title) — may be comma-separated: "왕강철,미나짱"
    const authorText = $('h4.fw-bold').parent().find('.text-secondary').first().text().trim();
    const authors = authorText
        ? authorText.split(/[,，\/]/).map(s => s.trim()).filter(Boolean)
        : [];

    // Description from meta
    let description = '';
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    if (metaDesc) {
        // "청순남녀：description... - Xtoon"
        const parts = metaDesc.split('：');
        description = parts.length > 1
            ? parts.slice(1).join('：').replace(/\s*-\s*Xtoon\s*$/i, '').trim()
            : metaDesc.replace(/\s*-\s*Xtoon\s*$/i, '').trim();
    }

    // Tags/genres — ".tags .show a" contains links like "#드라마", "#7" (day of week)
    const genres = [];
    $('.tags .show a').each((_, el) => {
        const genre = $(el).text().replace('#', '').trim();
        if (genre) genres.push(genre);
    });

    // 19+ caution badge — <span> with "19" near title area
    const caution = $('span').filter((_, el) => /19\+?/.test($(el).text().trim())).length > 0;

    // Status: check chapter list for 최종화/완결/마지막/END markers
    const allChapterText = $('.j-chapter-item strong').text();
    const isCompleted = /최종화|완결|마지막화|END/i.test(allChapterText);
    const status = isCompleted ? 'completed' : 'ongoing';

    return {
        name: mangaName,
        slugName: mangaName,
        coverUrl,
        otherNames: '',
        genres,
        status,
        authors,
        description,
        caution,
    };
}

/**
 * Get full chapter list from detail page
 */
async function getFullChapterList(mangaSourceUrl) {
    const { fetchPage } = require('./base');
    const html = await fetchPage(mangaSourceUrl);
    return parseChapterList(html);
}

/**
 * Parse chapter list from detail page HTML
 * Chapters without parseable numbers (특별편, 후기, etc.) get a
 * fractional number (prev + 0.5) so they still get imported in order.
 */
function parseChapterList(html) {
    const $ = cheerio.load(html);

    // Collect raw items (detail page lists newest first)
    const rawItems = [];
    $('.j-chapter-item').each((_, el) => {
        const $item = $(el);
        const href = $item.attr('href') || '';
        const chapterUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        const strongText = $item.find('strong').text().trim();
        const title = strongText.replace(/\d+P\s*/g, '').replace(/\s*NEW\s*/g, '').trim();
        const dateText = $item.find('small.text-secondary').text().trim();
        const number = parseKoreanChapterNumber(strongText);

        rawItems.push({ number, url: chapterUrl, title, created_at: dateText || null });
    });

    // Reverse to oldest-first for numbering gaps
    rawItems.reverse();

    // Assign numbers: if parsed number > lastNumber, use it;
    // otherwise (null, duplicate, or backwards) → lastNumber + 0.5
    const chapters = [];
    let lastNumber = 0;
    for (const item of rawItems) {
        if (item.number !== null && item.number > lastNumber) {
            lastNumber = item.number;
            chapters.push({ ...item });
        } else {
            const gapNumber = lastNumber + 0.5;
            lastNumber = gapNumber;
            chapters.push({ ...item, number: gapNumber });
        }
    }

    return chapters;
}

/**
 * Get page images for a chapter
 * img.lazy-read[data-original] → image URLs
 */
async function getPageImages(chapterUrl) {
    const { fetchPage } = require('./base');
    const html = await fetchPage(chapterUrl);
    const $ = cheerio.load(html);

    const images = [];
    $('img.lazy-read').each((_, el) => {
        const src = $(el).attr('data-original') || '';
        if (src && src.startsWith('http')) {
            images.push(src);
        }
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
