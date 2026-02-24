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
    //     const $item = $(el);
    //     const name = $item.find('.title').text().trim();
    //     const url = $item.find('a').attr('href');
    //     const coverUrl = $item.find('img').attr('src');
    //     const chapters = [];
    //     // parse chapters...
    //     results.push({ name, url, coverUrl, chapters, latestChapterNum: chapters[0]?.number || 0 });
    // });

    return results;
}

/**
 * TODO: Parse manga detail page → extract manga info
 * Phải return: { name, coverUrl, otherNames, genres, status, authors, artists, tags, description }
 */
function extractMangaInfo(html) {
    const $ = cheerio.load(html);

    // TODO: Sửa selectors phù hợp
    return {
        name: '',
        coverUrl: '',
        otherNames: '',
        genres: [],        // → category + category_manga
        status: 'ongoing', // 'ongoing' | 'completed'
        authors: [],       // → author + author_manga (type=1)
        artists: [],       // → author + author_manga (type=2)
        tags: [],          // → tag + manga_tag
        description: '',
    };
}

/**
 * TODO: Lấy full danh sách chapter từ source URL
 * Phải return: [{ number, title, url }]
 *
 * Mặc định: fetch trang detail rồi parse chapter list từ HTML
 * (Nếu trang dùng API riêng như jestful thì override lại)
 */
async function getFullChapterList(mangaSourceUrl) {
    const html = await fetchPage(mangaSourceUrl);
    const $ = cheerio.load(html);
    const chapters = [];

    // TODO: Sửa selector phù hợp — ví dụ:
    // $('.chapter-list li a').each((_, el) => {
    //     const $a = $(el);
    //     const title = $a.text().trim();
    //     const number = parseChapterNumber(title);
    //     const url = $a.attr('href');
    //     if (number !== null) {
    //         chapters.push({ number, title, url });
    //     }
    // });

    return chapters;
}

module.exports = {
    name,
    baseUrl,
    match,
    parseHomepage,
    extractMangaInfo,
    getFullChapterList,
};
