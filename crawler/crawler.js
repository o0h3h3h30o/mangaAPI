/**
 * Core Crawler Logic
 * Crawl homepage → check DB → insert new chapters (is_show = 0)
 * Supports multiple source sites via parser registry
 */
const db = require('../config/database');
const { getParser, getAllParsers, getParserByName } = require('./parsers');
const base = require('./parsers/base');

// --------------- DB Lookups ---------------

/**
 * Find manga by source URL in from_manga18fx (comma-separated field)
 */
async function findMangaBySource(sourceUrl) {
    const [rows] = await db.query(
        'SELECT id, name, slug, from_manga18fx FROM manga WHERE from_manga18fx LIKE ? LIMIT 1',
        [`%${sourceUrl}%`]
    );
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Find manga by name (exact or FULLTEXT)
 */
async function findMangaByName(name) {
    // Try exact match first
    const [exact] = await db.query(
        'SELECT id, name, slug, from_manga18fx FROM manga WHERE name = ? LIMIT 1',
        [name]
    );
    if (exact.length > 0) return exact[0];

    // Try fulltext match
    const [ft] = await db.query(
        'SELECT id, name, slug, from_manga18fx, MATCH(name, otherNames) AGAINST(? IN BOOLEAN MODE) AS score FROM manga WHERE MATCH(name, otherNames) AGAINST(? IN BOOLEAN MODE) ORDER BY score DESC LIMIT 1',
        [name, name]
    );
    return ft.length > 0 && ft[0].score > 0 ? ft[0] : null;
}

/**
 * Get max chapter number for a manga
 */
async function getMaxChapterNumber(mangaId) {
    const [rows] = await db.query(
        'SELECT MAX(number) as maxNum FROM chapter WHERE manga_id = ?',
        [mangaId]
    );
    return rows[0]?.maxNum || 0;
}

// --------------- DB Writes ---------------

/**
 * Map status text → status_id (1=ongoing, 2=completed)
 */
function mapStatusId(status) {
    if (status === 'completed') return 2;
    return 1; // ongoing by default
}

/**
 * Find or create a category by name, return category_id
 */
async function findOrCreateCategory(name) {
    const slug = base.generateSlug(name);
    const [rows] = await db.query(
        'SELECT id FROM category WHERE slug = ? LIMIT 1',
        [slug]
    );
    if (rows.length > 0) return rows[0].id;

    const [result] = await db.query(
        'INSERT INTO category (name, slug, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [name, slug]
    );
    console.log(`    [+] Created category: "${name}" (id=${result.insertId})`);
    return result.insertId;
}

/**
 * Find or create an author/artist by name, return author_id
 * (author and artist share the same `author` table)
 */
async function findOrCreateAuthor(name) {
    const slug = base.generateSlug(name);
    const [rows] = await db.query(
        'SELECT id FROM author WHERE slug = ? LIMIT 1',
        [slug]
    );
    if (rows.length > 0) return rows[0].id;

    const [result] = await db.query(
        'INSERT INTO author (name, slug, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [name, slug]
    );
    console.log(`    [+] Created author: "${name}" (id=${result.insertId})`);
    return result.insertId;
}

/**
 * Find or create a tag by name, return tag_id
 */
async function findOrCreateTag(name) {
    const slug = base.generateSlug(name);
    const [rows] = await db.query(
        'SELECT id FROM tag WHERE slug = ? LIMIT 1',
        [slug]
    );
    if (rows.length > 0) return rows[0].id;

    const [result] = await db.query(
        'INSERT INTO tag (name, slug, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [name, slug]
    );
    console.log(`    [+] Created tag: "${name}" (id=${result.insertId})`);
    return result.insertId;
}

/**
 * Insert new manga record with categories and authors
 */
async function insertManga(data) {
    const slug = base.generateSlug(data.name);
    const statusId = mapStatusId(data.status);

    const [result] = await db.query(
        `INSERT INTO manga (name, slug, summary, otherNames, from_manga18fx, status_id, is_public, created_at, create_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), UNIX_TIMESTAMP())`,
        [
            data.name,
            slug,
            data.description || '',
            data.otherNames || '',
            data.sourceUrl || '',
            statusId,
        ]
    );

    const mangaId = result.insertId;
    console.log(`  [+] Inserted manga: "${data.name}" (id=${mangaId})`);

    // Link categories
    if (Array.isArray(data.genres) && data.genres.length > 0) {
        const catIds = [];
        for (const genre of data.genres) {
            const catId = await findOrCreateCategory(genre);
            catIds.push(catId);
        }
        const catValues = catIds.map(cid => [cid, mangaId]);
        await db.query('INSERT IGNORE INTO category_manga (category_id, manga_id) VALUES ?', [catValues]);
        console.log(`  [+] Linked ${catIds.length} categories`);
    }

    // Link authors (type=1) and artists (type=2)
    const authorEntries = [];
    if (Array.isArray(data.authors) && data.authors.length > 0) {
        for (const authorName of data.authors) {
            const authorId = await findOrCreateAuthor(authorName);
            authorEntries.push([authorId, mangaId, 1]); // type=1 (author)
        }
    }
    if (Array.isArray(data.artists) && data.artists.length > 0) {
        for (const artistName of data.artists) {
            const artistId = await findOrCreateAuthor(artistName);
            authorEntries.push([artistId, mangaId, 2]); // type=2 (artist)
        }
    }
    if (authorEntries.length > 0) {
        await db.query('INSERT IGNORE INTO author_manga (author_id, manga_id, type) VALUES ?', [authorEntries]);
        console.log(`  [+] Linked ${authorEntries.length} authors/artists`);
    }

    // Link tags
    if (Array.isArray(data.tags) && data.tags.length > 0) {
        const tagIds = [];
        for (const tagName of data.tags) {
            const tagId = await findOrCreateTag(tagName);
            tagIds.push(tagId);
        }
        const tagValues = tagIds.map(tid => [tid, mangaId]);
        await db.query('INSERT IGNORE INTO manga_tag (tag_id, manga_id) VALUES ?', [tagValues]);
        console.log(`  [+] Linked ${tagIds.length} tags`);
    }

    return mangaId;
}

/**
 * Append source URL to from_manga18fx field
 */
async function appendSourceUrl(mangaId, currentValue, newSourceUrl) {
    if (currentValue && currentValue.includes(newSourceUrl)) return;
    const updated = currentValue ? `${currentValue},${newSourceUrl}` : newSourceUrl;
    await db.query(
        'UPDATE manga SET from_manga18fx = ? WHERE id = ?',
        [updated, mangaId]
    );
    console.log(`  [~] Updated from_manga18fx for manga id=${mangaId}`);
}

/**
 * Batch insert chapters with is_show = 0
 * Uses INSERT IGNORE to skip duplicates (unique_manga_chapter)
 */
async function insertChapters(mangaId, chapters) {
    if (chapters.length === 0) return 0;

    const values = chapters.map(ch => [
        mangaId,
        ch.title || `Chapter ${ch.number}`,
        base.generateChapterSlug(ch.number),
        ch.number,
        0,  // is_show = 0
        ch.url || '',
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const flat = values.flat();

    const [result] = await db.query(
        `INSERT IGNORE INTO chapter (manga_id, name, slug, number, is_show, source_url)
         VALUES ${placeholders}`,
        flat
    );

    console.log(`  [+] Inserted ${result.affectedRows} chapters for manga id=${mangaId}`);
    return result.affectedRows;
}

/**
 * Update denormalized chapter fields on manga table
 */
async function updateMangaDenormalized(mangaId) {
    const [rows] = await db.query(
        `SELECT number, slug, name, created_at FROM chapter
         WHERE manga_id = ? AND is_show = 1
         ORDER BY number DESC LIMIT 2`,
        [mangaId]
    );

    if (rows.length === 0) return;

    const ch1 = rows[0];
    const ch2 = rows[1] || null;

    const updates = {
        chapter_1: ch1.number,
        chap_1_slug: ch1.slug,
        time_chap_1: Math.floor(new Date(ch1.created_at).getTime() / 1000),
        update_at: Math.floor(Date.now() / 1000),
    };

    if (ch2) {
        updates.chapter_2 = ch2.number;
        updates.chap_2_slug = ch2.slug;
        updates.time_chap_2 = Math.floor(new Date(ch2.created_at).getTime() / 1000);
    }

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(updates);

    await db.query(`UPDATE manga SET ${sets} WHERE id = ?`, [...vals, mangaId]);
}

// --------------- Main Crawl Logic ---------------

/**
 * Process a single manga item from homepage
 * Automatically detects the correct parser from item.url
 */
async function processManga(item) {
    const sourceUrl = item.url;
    const siteParser = getParser(sourceUrl);
    console.log(`\n[*] Processing: ${item.name} (latest: Ch.${item.latestChapterNum}) [${siteParser.name}]`);

    // Step 1: Check if manga exists by source URL
    let manga = await findMangaBySource(sourceUrl);

    if (manga) {
        // === EXISTING MANGA ===
        console.log(`  [=] Found in DB: id=${manga.id}, slug=${manga.slug}`);

        const dbMax = await getMaxChapterNumber(manga.id);
        console.log(`  [=] DB max chapter: ${dbMax}, Source latest: ${item.latestChapterNum}`);

        if (item.latestChapterNum <= dbMax) {
            console.log(`  [=] Up to date, skipping`);
            return { status: 'skipped', name: item.name };
        }

        // Fetch full chapter list via parser
        console.log(`  [>] Fetching full chapter list...`);
        const allChapters = await siteParser.getFullChapterList(sourceUrl);
        const newChapters = allChapters.filter(ch => ch.number > dbMax);
        console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

        const inserted = await insertChapters(manga.id, newChapters);
        return { status: 'updated', name: item.name, inserted };

    } else {
        // === NEW MANGA ===
        // Check by name first (could exist from another source)
        manga = await findMangaByName(item.name);

        if (manga) {
            // Name match → append source URL
            console.log(`  [~] Name match found: id=${manga.id}, "${manga.name}"`);
            await appendSourceUrl(manga.id, manga.from_manga18fx, sourceUrl);

            // Fetch full chapter list via parser
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await siteParser.getFullChapterList(sourceUrl);
            const dbMax = await getMaxChapterNumber(manga.id);
            const newChapters = allChapters.filter(ch => ch.number > dbMax);
            console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

            const inserted = await insertChapters(manga.id, newChapters);
            return { status: 'linked', name: item.name, mangaId: manga.id, inserted };

        } else {
            // Brand new manga → fetch detail page for info
            console.log(`  [+] New manga, fetching detail...`);
            const detailHtml = await base.fetchPage(sourceUrl);
            const info = siteParser.extractMangaInfo(detailHtml);
            console.log(`  [+] Parsed: "${info.name}", genres=[${info.genres.join(', ')}], status=${info.status}`);

            const mangaId = await insertManga({
                name: info.name || item.name,
                description: info.description,
                otherNames: info.otherNames,
                authors: info.authors,
                status: info.status,
                genres: info.genres,
                sourceUrl: sourceUrl,
            });

            // Fetch full chapter list via parser
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await siteParser.getFullChapterList(sourceUrl);
            console.log(`  [>] Found ${allChapters.length} chapters`);

            const inserted = await insertChapters(mangaId, allChapters);
            return { status: 'created', name: item.name, mangaId, inserted };
        }
    }
}

/**
 * Crawl a single source site by parser name
 */
async function crawlSite(parserName) {
    const siteParser = getParserByName(parserName);
    console.log(`=== Crawl: ${siteParser.name} (${siteParser.baseUrl}) ===`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    const html = await base.fetchPage(siteParser.baseUrl);
    const items = siteParser.parseHomepage(html);

    console.log(`Found ${items.length} manga on homepage\n`);

    const results = { skipped: 0, updated: 0, created: 0, linked: 0, errors: 0 };

    for (const item of items) {
        try {
            const result = await processManga(item);
            results[result.status] = (results[result.status] || 0) + 1;
        } catch (err) {
            console.error(`  [!] Error processing "${item.name}":`, err.message);
            results.errors++;
        }
    }

    console.log(`\n=== Summary [${siteParser.name}] ===`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Updated: ${results.updated}`);
    console.log(`Created: ${results.created}`);
    console.log(`Linked:  ${results.linked}`);
    console.log(`Errors:  ${results.errors}`);

    return results;
}

/**
 * Crawl all registered source sites
 */
async function crawlAll() {
    const allResults = {};
    for (const siteParser of getAllParsers()) {
        allResults[siteParser.name] = await crawlSite(siteParser.name);
    }
    return allResults;
}

module.exports = {
    crawlSite,
    crawlAll,
    processManga,
    findMangaBySource,
    findMangaByName,
    getMaxChapterNumber,
    insertChapters,
    insertManga,
    updateMangaDenormalized,
};
