/**
 * Parser for hentairead.com (English hentai manga / doujinshi)
 *
 * Homepage: /hentai/page/{N}/?m_orderby=latest
 * Detail:   /hentai/{slug}/
 * Reader:   /hentai/{slug}/english/p/1/
 *
 * === Cấu trúc HTML ===
 * Homepage card: div.manga-item.loop-item
 *   Cover:    img.manga-item__img-inner[src]
 *   Name:     a.manga-item__link (text + href)
 *   Category: a.manga-item__cat-link (text)
 *   Tags:     div.manga-item__tags > span (text)
 *
 * Detail page:
 *   Title:    h1 (first)
 *   AltTitle: h2 (inside .manga-titles)
 *   Cover:    #mangaSummary img[src*="hencover.xyz"]
 *   Metadata: div.flex-wrap with label div (Language, Category, Artist, Tags, etc.)
 *   Pages:    li.chapter-image-item (preview thumbnails)
 *
 * Reader page:
 *   Images are base64-encoded JSON in: window.m{btoa(mangaId)} = 'base64data'
 *   CDN base: https://henread.xyz (from chapterExtraData.baseUrl)
 *   Image URL: {baseUrl}/{mangaId}/{chapterId}/hr_XXXX.jpg
 *
 * NOTE: Site chủ yếu là doujinshi (single chapter), mỗi manga = 1 chapter.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./base');

const BASE_URL = 'https://hentairead.com';
const IMAGE_CDN = 'https://henread.xyz';
const DEFAULT_PAGES = 3;

// --------------- Parser Interface ---------------

const name = 'hentairead';
const baseUrl = BASE_URL;

function match(url) {
    return url.includes('hentairead.com');
}

/**
 * Get homepage URLs (paginated, sorted by newest)
 */
function getHomepageUrls(pages, customUrl, startPage) {
    const count = pages || DEFAULT_PAGES;
    const start = startPage || 1;
    const urls = [];
    for (let page = start; page < start + count; page++) {
        if (customUrl) {
            // Support custom URL with page substitution
            urls.push(customUrl.includes('page/') ? customUrl : `${customUrl}page/${page}/`);
        } else {
            urls.push(`${BASE_URL}/hentai/page/${page}/?m_orderby=latest`);
        }
    }
    return urls;
}

/**
 * Parse homepage HTML → array of manga items
 *
 * Card: div.manga-item.loop-item
 *   a.manga-item__link → name + url
 *   img.manga-item__img-inner → cover
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('div.manga-item.loop-item').each((_, el) => {
        const $card = $(el);

        const $link = $card.find('a.manga-item__link').first();
        const mangaName = $link.text().trim();
        const url = $link.attr('href') || '';
        if (!mangaName || !url.includes('/hentai/')) return;

        const $img = $card.find('img.manga-item__img-inner').first();
        const coverUrl = ($img.attr('src') || '').trim();

        // Hentairead is mostly single-chapter, so we treat each manga as having chapter 1
        const chapters = [{ number: 1, url }];

        results.push({
            name: mangaName,
            url,
            coverUrl,
            chapters,
            latestChapterNum: 1,
        });
    });

    return results;
}

/**
 * Parse manga detail page → extract manga info
 *
 * Metadata is in labeled divs:
 *   div.flex-wrap > div.text-primary "Label:" + a[rel="tag"] or span
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // Title
    const mangaName = $('h1').first().text().trim();

    // Alternative title
    const otherNames = $('.manga-titles h2').text().trim();

    // Cover image
    const coverUrl = ($('#mangaSummary img[src*="hencover.xyz"]').first().attr('src')
        || $('#mangaSummary img').first().attr('src') || '').trim();

    // Parse labeled metadata sections
    const metadata = {};
    $('div.flex-wrap.items-center.gap-2').each((_, el) => {
        const $div = $(el);
        const label = $div.find('div.text-primary').first().text().trim().replace(/:$/, '');
        if (!label) return;

        const values = [];
        $div.find('a[rel="tag"] span.text-gray-100').each((_, tagEl) => {
            const v = $(tagEl).text().trim();
            if (v) values.push(v);
        });

        // Fallback for non-link values (Pages, Views)
        if (values.length === 0) {
            $div.find('span.text-gray-100').each((_, spanEl) => {
                const v = $(spanEl).text().trim();
                if (v) values.push(v);
            });
        }

        metadata[label.toLowerCase()] = values;
    });

    const artists = metadata['artist'] || [];
    const genres = metadata['category'] || [];
    const tags = metadata['tags'] || [];

    // Description from meta
    const description = $('meta[name="description"]').attr('content')
        || $('meta[property="og:description"]').attr('content') || '';

    return {
        name: mangaName,
        coverUrl,
        otherNames,
        genres,
        status: 'completed', // Doujinshi are generally complete works
        authors: artists,    // Use artist as author
        artists,
        tags,
        description,
        caution: true,       // 18+ content
        tipo: 'doujinshi',
    };
}

/**
 * Get full chapter list from manga detail page
 *
 * Hentairead is mostly single-chapter. We extract the reader URL
 * from the detail page and return it as chapter 1.
 */
async function getFullChapterList(mangaSourceUrl) {
    const html = await fetchPage(mangaSourceUrl);
    const $ = cheerio.load(html);

    // Find the reader link (e.g., /hentai/slug/english/p/1/)
    const readerUrl = $('a[href*="/p/1/"]').first().attr('href') || '';
    if (!readerUrl) return [];

    // Extract chapter base URL (strip /p/1/)
    const chapterBaseUrl = readerUrl.replace(/p\/\d+\/?$/, '').replace(/\/$/, '');

    return [{
        number: 1,
        title: 'Chapter 1',
        url: chapterBaseUrl,
    }];
}

/**
 * Get page images for a chapter
 *
 * Reader page embeds image data as base64 JSON in a global variable:
 *   window.m{btoa(mangaId).replace(/=+$/, '')} = 'base64EncodedJSON'
 *
 * The JSON structure: { data: { id, chapter: { images: [{src, width, height}] } } }
 * Image URL = {CDN_BASE}/{src}
 */
async function getPageImages(chapterUrl) {
    // Ensure we're fetching the reader page (need /p/1/ suffix)
    let readerUrl = chapterUrl;
    if (!readerUrl.match(/\/p\/\d+\/?$/)) {
        readerUrl = readerUrl.replace(/\/$/, '') + '/p/1/';
    }

    const html = await fetchPage(readerUrl);

    // Extract the CDN base URL from chapterExtraData
    const cdnMatch = html.match(/chapterExtraData\s*=\s*\{[^}]*"baseUrl"\s*:\s*"([^"]+)"/);
    const cdnBase = cdnMatch ? cdnMatch[1] : IMAGE_CDN;

    // Extract base64-encoded chapter data from window.m{varName} = 'data'
    const dataMatch = html.match(/window\.m[A-Za-z0-9+/]+ = '([A-Za-z0-9+/=]+)'/);
    if (!dataMatch) {
        // Fallback: try to extract preview images from detail page
        return extractPreviewImages(html);
    }

    try {
        const jsonStr = Buffer.from(dataMatch[1], 'base64').toString('utf-8');
        const data = JSON.parse(jsonStr);
        const images = data?.data?.chapter?.images || [];

        return images.map(img => `${cdnBase}/${img.src}`);
    } catch (e) {
        console.error(`[hentairead] Failed to decode chapter data: ${e.message}`);
        return extractPreviewImages(html);
    }
}

/**
 * Fallback: extract preview thumbnail images from the detail/reader page
 */
function extractPreviewImages(html) {
    const $ = cheerio.load(html);
    const images = [];
    $('li.chapter-image-item img').each((_, el) => {
        const src = $(el).attr('src') || '';
        if (src && src.includes('hencover.xyz')) {
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
