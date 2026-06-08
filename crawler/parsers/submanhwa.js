/**
 * Parser for submanhwa.com (Spanish manhwa CMS)
 *
 * Homepage:      /                              → .manga-item-v4 (listing)
 * Detail page:   /serie/{slug}                  → h1.manga-title-centered + a.chapter-link
 * Chapter page:  /serie/{slug}/{number}         → img[alt="... Page N"] (data-src | src)
 * Images host:   https://storage.submanhwa.net/...
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./base');

const BASE_URL = 'https://submanhwa.com';

// --------------- Parser Interface ---------------

const name = 'submanhwa';
const baseUrl = BASE_URL;

function match(url) {
    return url.includes('submanhwa.com');
}

/**
 * Homepage URLs — site lists all series on the root page (no real pagination)
 */
function getHomepageUrls() {
    return [`${BASE_URL}/`];
}

/**
 * Parse number from a chapter URL (/serie/{slug}/{number}) or fallback text
 */
function parseNumberFromUrl(url, fallbackText) {
    const m = (url || '').match(/\/(\d+(?:\.\d+)?)\/?$/);
    if (m) return parseFloat(m[1]);
    const t = (fallbackText || '').match(/(\d+(?:\.\d+)?)/);
    return t ? parseFloat(t[1]) : null;
}

/**
 * Parse homepage HTML → array of manga items
 * Each item: { name, url, coverUrl, chapters, latestChapterNum, latestChapterText }
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();

    $('.manga-item-v4').each((_, el) => {
        const $item = $(el);

        const url = $item.find('.manga-title-v4 a').attr('href')
            || $item.find('.manga-cover-wrapper a').attr('href')
            || '';
        if (!/\/serie\//.test(url) || seen.has(url)) return;
        seen.add(url);

        const mangaName = $item.find('.manga-title-v4 a').text().trim();
        if (!mangaName) return;

        const coverUrl = $item.find('img.manga-img-v4').attr('src') || '';

        const $ch = $item.find('.manga-chapter-v4 a').first();
        const chapterText = $ch.text().trim();
        const chapterUrl = $ch.attr('href') || '';
        const chapterNum = parseNumberFromUrl(chapterUrl, chapterText);

        results.push({
            name: mangaName,
            url,
            coverUrl,
            chapters: chapterNum !== null ? [{ number: chapterNum, url: chapterUrl }] : [],
            latestChapterNum: chapterNum || 0,
            latestChapterText: chapterText || '',
        });
    });

    return results;
}

/**
 * Extract manga info from detail page HTML
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    const mangaName = $('h1.manga-title-centered').first().text().trim();

    const coverUrl = $('.img-responsive[src*="cover"]').first().attr('src')
        || $('img.manga-img-v4').first().attr('src')
        || '';

    const genres = $('.genre-pill')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

    // Status — publication badge is <span class="label"> ("En Curso" / "Finalizado").
    // (Do NOT scan the whole body: the reading-status filter buttons also contain
    // the word "Finalizado" on every page and would mis-classify everything.)
    const statusText = $('span.label').first().text().trim();
    const status = /Finaliz|Complet/i.test(statusText) ? 'completed' : 'ongoing';

    let description = $('meta[name="description"]').attr('content') || '';
    description = description.trim();

    return {
        name: mangaName,
        slugName: mangaName,
        coverUrl,
        otherNames: '',
        genres,
        status,
        authors: [],
        artists: [],
        tags: [],
        description,
        caution: true, // adult manhwa site
    };
}

/**
 * Parse chapter list from detail page HTML → [{ number, title, url }]
 * Detail page lists newest-first; we return oldest-first.
 */
function parseChapterList(html) {
    const $ = cheerio.load(html);
    const chapters = [];

    $('a.chapter-link').each((_, el) => {
        const $a = $(el);
        let url = $a.attr('href') || '';
        if (!url) return;
        if (!url.startsWith('http')) url = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;

        const rawTitle = $a.text().trim().replace(/\s+/g, ' ').replace(/\s*:\s*$/, '');
        const number = parseNumberFromUrl(url, rawTitle);
        if (number === null) return;

        chapters.push({ number, title: rawTitle || `Capítulo ${number}`, url });
    });

    // De-dupe by number, keep oldest-first
    const byNum = new Map();
    for (const ch of chapters) if (!byNum.has(ch.number)) byNum.set(ch.number, ch);
    return [...byNum.values()].sort((a, b) => a.number - b.number);
}

/**
 * Get full chapter list from detail page
 */
async function getFullChapterList(mangaSourceUrl) {
    const html = await fetchPage(mangaSourceUrl);
    return parseChapterList(html);
}

/**
 * Get page images for a chapter.
 *
 * Reader imgs carry alt="<manga>: Chapter X - Page N". First pages are eager
 * (class "img-responsive"), later pages lazy (class "lazy-smart" + data-src),
 * and page 1 is duplicated (a "scan-page" copy). We key by the Page number to
 * dedupe + order correctly, and the "Créditos" image (no Page N) is skipped.
 */
async function getPageImages(chapterUrl) {
    const html = await fetchPage(chapterUrl);
    const $ = cheerio.load(html);

    const byPage = new Map();
    $('img').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const m = alt.match(/Page (\d+)\s*$/i);
        if (!m) return;
        const src = $(el).attr('data-src') || $(el).attr('src') || '';
        if (!src.startsWith('http')) return;
        const page = parseInt(m[1], 10);
        if (!byPage.has(page)) byPage.set(page, src);
    });

    if (byPage.size > 0) {
        return [...byPage.keys()].sort((a, b) => a - b).map(p => byPage.get(p));
    }

    // Fallback: no Page-numbered alts → take every reader image inside the
    // #all container, in DOM order. Host-agnostic on purpose: chapter images
    // live on various CDNs (storage.submanhwa.net, submanhwa.com/uploads,
    // media.ikigaimangas.cloud, ...), so we must not filter by hostname.
    const images = [];
    const seen = new Set();
    $('#all img').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        if (/cr[eé]dito/i.test(alt)) return; // skip the "Créditos" promo image
        const src = $(el).attr('data-src') || $(el).attr('src') || '';
        if (src.startsWith('http') && !seen.has(src)) {
            seen.add(src);
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
