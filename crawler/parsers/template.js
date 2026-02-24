/**
 * Parser Template
 * Copy file này và đổi tên: cp template.js newsource.js
 * Sửa các chỗ đánh dấu TODO bên dưới
 * File sẽ tự động được registry detect khi nằm trong thư mục parsers/
 */
const cheerio = require('cheerio');
const { fetchPage, parseChapterNumber } = require('./base');

// TODO: Đổi tên và URL cho trang nguồn mới
const name = 'TODO-site-name';
const baseUrl = 'https://TODO-example.com';

/**
 * TODO: Kiểm tra URL có thuộc trang này không
 */
function match(url) {
    return url.includes('TODO-example.com');
}

/**
 * TODO: Parse homepage HTML → array of manga items
 * Mỗi item phải có: { name, url, coverUrl, chapters: [{number, title, url}], latestChapterNum }
 */
function parseHomepage(html) {
    const $ = cheerio.load(html);
    const results = [];

    // TODO: Sửa selector phù hợp với trang nguồn
    // $('.manga-item').each((_, el) => {
    //     results.push({ name, url, coverUrl, chapters: [], latestChapterNum: 0 });
    // });

    return results;
}

/**
 * TODO: Parse manga detail page → extract manga info
 * Phải return: { name, coverUrl, otherNames, genres, status, authors, description }
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // TODO: Sửa selectors phù hợp
    return {
        name: '',
        coverUrl: '',
        otherNames: '',
        genres: [],
        status: 'ongoing', // 'ongoing' | 'completed'
        authors: [],
        description: '',
    };
}

/**
 * TODO: Lấy full danh sách chapter từ source URL
 * Phải return: [{ number, title, url }]
 */
async function getFullChapterList(mangaSourceUrl) {
    // TODO: Implement
    // Có thể cần fetch thêm API riêng (như jestful)
    return [];
}

module.exports = {
    name,
    baseUrl,
    match,
    parseHomepage,
    extractMangaInfo,
    getFullChapterList,
};
