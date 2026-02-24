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
 * Parse manga detail page HTML → manga info + full chapter list
 * TODO: Selectors cần điều chỉnh khi có HTML detail page thực tế
 */
function parseDetailPage(html) {
    const $ = cheerio.load(html);

    const name = $('h1').first().text().trim()
        || $('h2.widget-title').first().text().trim()
        || '';

    const description = $('.summary_content .post-content_item:contains("Description") .summary-content').text().trim()
        || $('.manga-info-text li:contains("Description")').text().replace('Description :', '').trim()
        || '';

    const otherNames = $('.manga-info-text li:contains("Other name")').text().replace('Other name(s) :', '').trim()
        || '';

    const authors = [];
    $('.manga-info-text li:contains("Author") a').each((_, el) => {
        const author = $(el).text().trim();
        if (author) authors.push(author);
    });

    const categories = [];
    $('.manga-info-text li:contains("Genres") a, .genres-content a').each((_, el) => {
        const cat = $(el).text().trim();
        if (cat) categories.push(cat);
    });

    const statusText = $('.manga-info-text li:contains("Status")').text().toLowerCase() || '';
    let status = 'ongoing';
    if (statusText.includes('completed') || statusText.includes('finished')) {
        status = 'completed';
    }

    // Full chapter list from detail page
    const chapters = [];
    $('ul.row-content-chapter li a, .chapter-list .row a, .listing-chapters_wrap a').each((_, el) => {
        const $ch = $(el);
        const title = $ch.attr('title') || $ch.text().trim();
        const chapterRelUrl = $ch.attr('href') || '';
        const number = parseChapterNumber($ch.text());

        if (number !== null) {
            chapters.push({
                number,
                title,
                url: buildFullUrl(chapterRelUrl),
            });
        }
    });

    return { name, description, otherNames, authors, categories, status, chapters };
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
    parseDetailPage,
    parseChapterNumber,
    generateSlug,
    generateChapterSlug,
    buildFullUrl,
};
