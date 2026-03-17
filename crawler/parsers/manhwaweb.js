/**
 * Parser for manhwaweb.com
 * Uses JSON API backend at manhwawebbackend-production.up.railway.app
 *
 * API endpoints:
 *   List:    /manhwa/library?page=1&order_item=last_update&order_dir=desc
 *   Detail:  /manhwa/see/{real_id}
 *   Chapter: /chapters/see/{real_id}-{chapter}
 */
const { withProxy } = require('../proxy');

const name = 'manhwaweb';
const baseUrl = 'https://manhwaweb.com';
const API_BASE = 'https://manhwawebbackend-production.up.railway.app';
const DEFAULT_PAGES = 3;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Genre ID → name mapping
const GENRE_MAP = {
    1: 'Drama', 3: 'Action', 4: 'Thriller', 5: 'Horror',
    6: 'Sci-Fi', 7: 'Supernatural', 8: 'Mystery', 9: 'Slice of Life',
    10: 'Romance', 11: 'Psychological', 12: 'Sports', 13: 'Historical',
    14: 'Mecha', 15: 'Music', 16: 'Tragedy', 17: 'Martial Arts',
    18: 'Comedy', 19: 'Harem', 20: 'Mature', 21: 'Smut',
    22: 'School', 23: 'Fantasy', 24: 'Gender Bender', 25: 'Yaoi',
    26: 'Yuri', 27: 'Shoujo Ai', 28: 'Shounen Ai', 29: 'Adventure',
    30: 'Ecchi', 31: 'Doujinshi', 32: 'Isekai', 33: 'Survival',
    34: 'Crime', 35: 'Medical', 36: 'Cooking', 37: 'Military',
    38: 'Police', 39: 'Space', 40: 'Game', 41: 'Demons',
    42: 'Vampire', 43: 'Zombie', 44: 'Gore', 45: 'Monsters',
    46: 'Samurai', 47: 'Ninja', 48: 'Philosophical', 49: 'Magic',
    50: 'Reincarnation', 51: 'Office Workers',
};

function match(url) {
    return url.includes('manhwaweb.com') || url.includes('manhwawebbackend-production.up.railway.app');
}

async function fetchJson(url) {
    const res = await fetch(url, withProxy({
        headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://manhwaweb.com' },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

/**
 * Get homepage URLs (paginated API)
 */
function getHomepageUrls(pages, customUrl, startPage) {
    const count = pages || DEFAULT_PAGES;
    const start = startPage || 1;
    const urls = [];
    for (let page = start; page < start + count; page++) {
        if (customUrl) {
            urls.push(customUrl.replace(/page=\d+/, `page=${page}`));
        } else {
            urls.push(`${API_BASE}/manhwa/library?buscar=&estado=&tipo=&erotico=&demografia=&order_item=last_update&order_dir=desc&page=${page}&generes=`);
        }
    }
    return urls;
}

/**
 * Parse homepage JSON → array of manga items
 */
function parseHomepage(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const items = data.data || [];
    const results = [];

    for (const item of items) {
        const realId = item.real_id || item._id;
        if (!realId) continue;

        results.push({
            name: item.name_raw || item.the_real_name || item.name_esp || '',
            url: `${API_BASE}/manhwa/see/${realId}`,
            coverUrl: item._imagen || '',
            chapters: [],
            latestChapterNum: item._numero_cap || 0,
        });
    }

    return results;
}

/**
 * Parse manga detail JSON → extract manga info
 */
function extractMangaInfo(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;

    const genres = [];
    if (Array.isArray(data._categoris)) {
        for (const cat of data._categoris) {
            if (typeof cat === 'object') {
                // { "1": "Drama" } format from detail API
                const val = Object.values(cat)[0];
                if (val) genres.push(val);
            } else if (typeof cat === 'number') {
                // Number format from list API
                if (GENRE_MAP[cat]) genres.push(GENRE_MAP[cat]);
            }
        }
    }

    let status = 'ongoing';
    if (data._status === 'finalizado') status = 'completed';

    const authors = data._extras?.autores || [];

    return {
        name: data.name_raw || data.the_real_name || data.name_esp || '',
        slugName: data.name_raw || data.the_real_name || data.name_esp || '',
        coverUrl: data._imagen || '',
        otherNames: [data.the_real_name, data.name_esp, data.name_raw].filter(Boolean).join(', '),
        genres,
        status,
        authors,
        artists: [],
        tags: [],
        description: data._sinopsis || '',
        caution: data._erotico === 'si',
    };
}

/**
 * Get full chapter list from manga detail API
 */
async function getFullChapterList(mangaSourceUrl) {
    const data = await fetchJson(mangaSourceUrl);
    const chapters = data.chapters || [];

    return chapters.map(ch => ({
        number: ch.chapter,
        url: `${API_BASE}/chapters/see/${data.real_id}-${ch.chapter}`,
        created_at: ch.create ? new Date(ch.create).toISOString() : null,
    }));
}

/**
 * Get page images for a chapter
 */
async function getPageImages(chapterUrl) {
    const data = await fetchJson(chapterUrl);
    return data.chapter?.img || [];
}

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
