/**
 * Parser for comix.to
 *
 * Uses the comix.to public JSON API at https://comix.to/api/v2
 *   List:     /manga?page=N&order[chapter_updated_at]=desc&limit=100
 *   Detail:   /manga/{hash_id}
 *   Chapters: /manga/{hash_id}/chapters?page=N&limit=100   (SIGNED — stub fails)
 *   Images:   /chapters/{chapter_id}
 *
 * Ported from the reference script comix-import.ts. Term ID mappings
 * (genres / themes / demographic / NSFW rating) are copied verbatim and
 * will drift if comix.to adds new IDs — refresh against /genres and
 * /browser filter on the site when needed.
 */
const { unsignedFetch, signedFetch, SIGNING_NOT_IMPL } = require('./comix-sign');

const name = 'comix';
const baseUrl = 'https://comix.to';
const API_BASE = 'https://comix.to/api/v2';
const DEFAULT_PAGES = 3;

// ─── Term ID → genre / theme / demographic / NSFW mapping ─────────

// term_id → demographic label (from /browser filter)
const DEMOGRAPHIC_IDS = {
    1: 'shoujo',
    2: 'shounen',
    3: 'josei',
    4: 'seinen',
};

// NSFW theme term_id → content rating severity.
// Highest severity wins — escalates `caution` flag.
const NSFW_RATING_MAP = {
    87266: 'pornographic', // Hentai
    87264: 'erotica',      // Adult
    87267: 'erotica',      // Mature
    87268: 'erotica',      // Smut
    87265: 'suggestive',   // Ecchi
};
const RATING_SEVERITY = {
    safe: 0,
    suggestive: 1,
    erotica: 2,
    pornographic: 3,
};

// term_id → genre name
const GENRE_IDS = {
    6: 'Action',       7: 'Adventure',       8: 'Boys Love',
    9: 'Comedy',      10: 'Crime',          11: 'Drama',
    12: 'Fantasy',    13: 'Girls Love',     14: 'Historical',
    15: 'Horror',     16: 'Isekai',         17: 'Magical Girls',
    18: 'Mecha',      19: 'Medical',        20: 'Mystery',
    21: 'Philosophical', 22: 'Psychological', 23: 'Romance',
    24: 'Sci-Fi',     25: 'Slice of Life',  26: 'Sports',
    27: 'Superhero',  28: 'Thriller',       29: 'Tragedy',
    30: 'Wuxia',
};

// term_id → theme name (additional tags, incl. NSFW 87264..87268)
const THEME_IDS = {
    31: 'Aliens',      32: 'Animals',         33: 'Cooking',
    34: 'Crossdressing', 35: 'Delinquents',   36: 'Demons',
    37: 'Genderswap',  38: 'Ghosts',          39: 'Gyaru',
    40: 'Harem',       41: 'Incest',          42: 'Loli',
    43: 'Mafia',       44: 'Magic',           45: 'Martial Arts',
    46: 'Military',    47: 'Monster Girls',   48: 'Monsters',
    49: 'Music',       50: 'Ninja',           51: 'Office Workers',
    52: 'Police',      53: 'Post-Apocalyptic', 54: 'Reincarnation',
    55: 'Reverse Harem', 56: 'Samurai',       57: 'School Life',
    58: 'Shota',       59: 'Supernatural',    60: 'Survival',
    61: 'Time Travel', 62: 'Traditional Games', 63: 'Vampires',
    64: 'Video Games', 65: 'Villainess',      66: 'Virtual Reality',
    67: 'Zombies',
    87264: 'Adult',    87265: 'Ecchi',        87266: 'Hentai',
    87267: 'Mature',   87268: 'Smut',
};

/**
 * Resolve an array of term_ids into grouped labels + escalated content rating.
 */
function resolveTermIds(termIds) {
    const genres = [];
    const themes = [];
    let demographic = null;
    let maxSeverity = 0;
    let contentRating = 'safe';

    for (const id of termIds || []) {
        if (DEMOGRAPHIC_IDS[id]) {
            demographic = DEMOGRAPHIC_IDS[id];
            continue;
        }
        if (GENRE_IDS[id]) genres.push(GENRE_IDS[id]);
        else if (THEME_IDS[id]) themes.push(THEME_IDS[id]);

        const rating = NSFW_RATING_MAP[id];
        if (rating && RATING_SEVERITY[rating] > maxSeverity) {
            maxSeverity = RATING_SEVERITY[rating];
            contentRating = rating;
        }
    }
    return { genres, themes, demographic, contentRating };
}

// ─── Parser Interface ──────────────────────────────────────────────

function match(url) {
    return !!url && url.includes('comix.to');
}

/**
 * Build paginated list URLs, ordered by most recent chapter update.
 *   pages     — how many pages to crawl (default 3)
 *   customUrl — pass through a different list URL (e.g. genre filter)
 *   startPage — first page number (default 1)
 */
function getHomepageUrls(pages, customUrl, startPage) {
    const count = pages || DEFAULT_PAGES;
    const start = startPage || 1;

    if (customUrl) {
        const urls = [];
        for (let page = start; page < start + count; page++) {
            urls.push(customUrl.replace(/([?&])page=\d+/, `$1page=${page}`));
        }
        return urls;
    }

    const urls = [];
    for (let page = start; page < start + count; page++) {
        // URL-encoded order[chapter_updated_at]=desc
        urls.push(
            `${API_BASE}/manga?limit=100&page=${page}` +
            `&order%5Bchapter_updated_at%5D=desc`
        );
    }
    return urls;
}

/**
 * Parse /manga list JSON → array of manga items.
 */
function parseHomepage(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const items = data.result?.items || [];
    const results = [];

    for (const item of items) {
        const hashId = item.hash_id;
        if (!hashId) continue;

        const coverUrl = item.poster?.large || item.poster?.medium || item.poster?.small || '';

        results.push({
            name: item.title || '',
            url: `${API_BASE}/manga/${hashId}`,
            coverUrl,
            chapters: [],
            latestChapterNum: parseFloat(item.latest_chapter || item.final_chapter || 0) || 0,
            // Extra metadata the default crawler ignores but recrawl scripts may use
            hashId,
            hasChapters: !!item.has_chapters,
        });
    }

    return results;
}

/**
 * Parse /manga/{hash} detail JSON → info shape used by crawler.insertManga.
 */
function extractMangaInfo(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const m = data.result || {};

    const title = m.title || '';
    const altTitles = Array.isArray(m.alt_titles) ? m.alt_titles : [];
    const otherNames = altTitles.filter(Boolean).join(', ');

    const coverUrl = m.poster?.large || m.poster?.medium || m.poster?.small || '';

    const { genres, themes, demographic, contentRating } = resolveTermIds(m.term_ids || []);

    // `caution` is true when rating is erotica or worse, or when API flags is_nsfw.
    const ratingSeverity = RATING_SEVERITY[contentRating] || 0;
    const caution = !!m.is_nsfw || ratingSeverity >= RATING_SEVERITY.erotica;

    // Map API status → internal
    let status = 'ongoing';
    if (m.status === 'finished') status = 'completed';

    // Type: manhwa / manhua / doujinshi → pass-through, 'other' → 'manga'
    let tipo;
    if (m.type === 'manhwa' || m.type === 'manhua' || m.type === 'doujinshi') tipo = m.type;
    else tipo = 'manga';

    // comix.to doesn't surface authors/artists in these endpoints — leave empty.
    // When/if they appear under m.authors or m.artists, extract here.
    const authors = [];

    // Merge themes into genres for DB (crawler stores one flat list).
    // Demographic label also appended so it becomes a browsable category.
    const allGenres = [...genres, ...themes];
    if (demographic) allGenres.push(demographic.charAt(0).toUpperCase() + demographic.slice(1));

    return {
        skip: !title,
        name: title,
        slugName: m.slug || title,
        coverUrl,
        otherNames,
        genres: allGenres,
        status,
        authors,
        description: m.synopsis || '',
        caution,
        tipo,
    };
}

/**
 * Fetch full chapter list for a manga.
 * Endpoint is signed — without comix-sign.js implemented, this throws a
 * clear error so the crawler skips instead of silently producing empty data.
 */
async function getFullChapterList(mangaSourceUrl) {
    const hashId = extractHashId(mangaSourceUrl);
    if (!hashId) {
        throw new Error(`Cannot extract hash_id from: ${mangaSourceUrl}`);
    }

    const chapters = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        let data;
        try {
            data = await signedFetch(
                `/manga/${hashId}/chapters`,
                { limit: 100, page }
            );
        } catch (err) {
            if (err === SIGNING_NOT_IMPL || err.message === SIGNING_NOT_IMPL.message) {
                console.warn(
                    `  [!] comix chapter list needs signing — see crawler/parsers/comix-sign.js`
                );
            }
            throw err;
        }

        const items = data.result?.items || [];
        for (const raw of items) {
            const num = parseFloat(raw.number ?? '0');
            if (!Number.isFinite(num)) continue;

            chapters.push({
                number: num,
                url: `${API_BASE}/chapters/${raw.chapter_id}`,
                title: raw.name || null,
                created_at: raw.created_at
                    ? new Date(raw.created_at * 1000).toISOString()
                    : null,
            });
        }

        const pg = data.result?.pagination;
        hasMore = pg ? pg.current_page < pg.last_page : false;
        page++;
    }

    // Most comix endpoints return newest-first; normalise to ascending by
    // chapter number to match the crawler's insertion expectations.
    chapters.sort((a, b) => a.number - b.number);
    return chapters;
}

/**
 * Fetch image URLs for a single chapter. Unsigned — works out of the box.
 */
async function getPageImages(chapterUrl) {
    // chapterUrl = https://comix.to/api/v2/chapters/{chapter_id}
    const data = await unsignedFetch(chapterUrl);
    const images = data.result?.images || [];
    return images.map(img => img.url).filter(Boolean);
}

function formatChapterTitle(number) {
    return `Chapter ${number}`;
}

// ─── Internal Helpers ──────────────────────────────────────────────

/**
 * Pull hash_id out of any comix URL variant:
 *   https://comix.to/api/v2/manga/7ryn2          → '7ryn2'
 *   https://comix.to/manga/some-title-slug_7ryn2 → '7ryn2'   (appended hash)
 *   https://comix.to/manga/some-title-slug       → null      (slug only, no hash)
 */
function extractHashId(url) {
    if (!url) return null;

    // API pattern first
    const apiMatch = url.match(/\/api\/v2\/manga\/([^\/\?#]+)/);
    if (apiMatch) return apiMatch[1];

    // Web URL — hash_id often trails after underscore in slug
    const webMatch = url.match(/\/manga\/([^\/\?#]+)/);
    if (webMatch) {
        const slug = webMatch[1];
        // Heuristic: 5-char alnum hash at end after underscore, e.g. "title_7ryn2"
        const hashPart = slug.match(/_([a-z0-9]{4,8})$/i);
        if (hashPart) return hashPart[1];
        // Bare short slugs could be hash_ids themselves (5 chars alnum)
        if (/^[a-z0-9]{4,8}$/i.test(slug)) return slug;
    }
    return null;
}

// Domain fragments for SQL LIKE matching (used by run-recrawl-* scripts).
const urlPatterns = ['comix.to'];

module.exports = {
    name,
    baseUrl,
    urlPatterns,
    match,
    getHomepageUrls,
    parseHomepage,
    extractMangaInfo,
    getFullChapterList,
    getPageImages,
    formatChapterTitle,
    // Exported for unit testing
    resolveTermIds,
    extractHashId,
};
