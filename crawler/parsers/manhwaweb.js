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

/**
 * Check if text contains Korean characters (Hangul)
 */
function isKorean(text) {
    return /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text);
}

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
function getHomepageUrls(pages, customUrl) {
    if (customUrl) {
        const count = pages || DEFAULT_PAGES;
        const urls = [];
        for (let page = 1; page <= count; page++) {
            urls.push(customUrl.replace(/page=\d+/, `page=${page}`));
        }
        return urls;
    }
    // Default: single call to new-manhwa API
    return [`${API_BASE}/latest/new-manhwa`];
}

/**
 * Parse homepage JSON → array of manga items
 * Supports both /latest/new-manhwa and /manhwa/library formats
 */
function parseHomepage(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;

    // new-manhwa format: { manhwas: { _manhwas: [...], manhwas_esp: [...] } }
    const rawItems = [
        ...(data.manhwas?._manhwas || []),
        ...(data.manhwas?.manhwas_esp || []),
        ...(data.data || []),
    ];
    const results = [];
    const seen = new Set();

    for (const item of rawItems) {
        const realId = item.id_manhwa || item.real_id || item._id;
        if (!realId || seen.has(realId)) continue;
        seen.add(realId);

        // Skip novels
        if (item._tipo === 'novela') continue;

        const itemName = item.name_manhwa || item.name_raw || item.the_real_name || item.name_esp || '';
        if (isKorean(itemName)) continue;

        results.push({
            name: itemName,
            url: `${API_BASE}/manhwa/see/${realId}`,
            coverUrl: item.img || item._imagen || '',
            chapters: [],
            latestChapterNum: item.chapter || item._numero_cap || 0,
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
            // Detail API format: { "1": "Drama" }
            const val = Object.values(cat)[0];
            if (val) genres.push(val);
        }
    }

    let status = 'ongoing';
    if (data._status === 'finalizado') status = 'completed';

    const authors = data._extras?.autores || [];

    return {
        skip: isKorean(data.the_real_name || ''),
        name: data.name_esp || data.the_real_name || '',
        slugName: data.name_esp || data.the_real_name || '',
        coverUrl: data._imagen || '',
        otherNames: [...new Set([data._name, data.name_raw, data.name_esp, data.the_real_name].filter(Boolean))].join(', '),
        genres,
        status,
        authors,
        artists: [],
        tags: [],
        description: data._sinopsis || '',
        caution: data._erotico === 'si',
        tipo: data._tipo || null,
    };
}

/**
 * Get full chapter list from manga detail API
 */
async function getFullChapterList(mangaSourceUrl) {
    const data = await fetchJson(mangaSourceUrl);
    const chapters = data.chapters || [];

    return chapters
        .filter(ch => ch.link) // Skip chapters without link (locked/unreleased)
        .map(ch => ({
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

function formatChapterTitle(number) {
    return `Capítulo ${number}`;
}

// Domain fragments for SQL LIKE matching (used by run-recrawl-* scripts)
const urlPatterns = ['manhwaweb.com', 'manhwawebbackend-production.up.railway.app'];

module.exports = {
    name,
    baseUrl,
    urlPatterns,
    match,
    getHomepageUrls,
    parseHomepage,
    formatChapterTitle,
    extractMangaInfo,
    getFullChapterList,
    getPageImages,
};
