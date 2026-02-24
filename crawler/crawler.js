/**
 * Core Crawler Logic
 * Crawl homepage → check DB → insert new chapters (is_show = 0)
 * Supports multiple source sites via parser registry
 */
const db = require('../config/database');
const { getParser, getAllParsers, getParserByName } = require('./parsers');
const base = require('./parsers/base');
const { downloadAndProcessCover } = require('./cover-processor');
const { cacheDelPrefix } = require('../config/cache');

// --------------- DB Lookups ---------------

/**
 * Find manga by source URL in from_manga18fx (comma-separated field)
 */
async function findMangaBySource(sourceUrl) {
    const [rows] = await db.query(
        'SELECT id, name, slug, from_manga18fx, chapter_1 FROM manga WHERE from_manga18fx LIKE ? LIMIT 1',
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
        'SELECT id, name, slug, from_manga18fx, chapter_1 FROM manga WHERE name = ? LIMIT 1',
        [name]
    );
    if (exact.length > 0) return exact[0];

    // Try fulltext match (may fail if FULLTEXT index is missing)
    try {
        const [ft] = await db.query(
            'SELECT id, name, slug, from_manga18fx, chapter_1, MATCH(name, otherNames) AGAINST(? IN BOOLEAN MODE) AS score FROM manga WHERE MATCH(name, otherNames) AGAINST(? IN BOOLEAN MODE) ORDER BY score DESC LIMIT 1',
            [name, name]
        );
        return ft.length > 0 && ft[0].score > 0 ? ft[0] : null;
    } catch {
        return null;
    }
}

/**
 * Get max chapter number for a manga
 */
async function getMaxChapterNumber(mangaId) {
    const [rows] = await db.query(
        'SELECT MAX(CAST(number AS DECIMAL(10,2))) as maxNum FROM chapter WHERE manga_id = ?',
        [mangaId]
    );
    return rows[0]?.maxNum || 0;
}

/**
 * Get all existing chapter numbers for a manga (as Set of floats)
 */
async function getExistingChapterNumbers(mangaId) {
    const [rows] = await db.query(
        'SELECT CAST(number AS DECIMAL(10,2)) as num FROM chapter WHERE manga_id = ?',
        [mangaId]
    );
    return new Set(rows.map(r => parseFloat(r.num)));
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

    // Safety: filter out chapters whose number already exists in DB
    const existingNums = await getExistingChapterNumbers(mangaId);
    const filtered = chapters.filter(ch => !existingNums.has(ch.number));
    if (filtered.length === 0) {
        console.log(`  [=] All ${chapters.length} chapters already exist, nothing to insert`);
        return 0;
    }
    if (filtered.length < chapters.length) {
        console.log(`  [~] Filtered out ${chapters.length - filtered.length} duplicate chapters`);
    }

    const values = filtered.map(ch => [
        mangaId,
        ch.title || `第${ch.number}話`,
        base.generateChapterSlug(ch.number),
        ch.number,
        0,  // is_show = 0
        ch.url || '',
        ch.created_at || new Date().toISOString(),
        ch.created_at || new Date().toISOString(),
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flat = values.flat();

    const [result] = await db.query(
        `INSERT IGNORE INTO chapter (manga_id, name, slug, number, is_show, source_url, created_at, updated_at)
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
        const dbMax = parseFloat(manga.chapter_1) || 0;
        console.log(`  [=] Found in DB: id=${manga.id}, slug=${manga.slug}, chapter_1=${dbMax}`);

        if (item.latestChapterNum <= dbMax) {
            console.log(`  [=] Up to date, skipping`);
            return { status: 'skipped', name: item.name };
        }

        // Fetch full chapter list via parser
        console.log(`  [>] Fetching full chapter list...`);
        const allChapters = await siteParser.getFullChapterList(sourceUrl);

        // Keep only chapters newer than chapter_1 (the latest published)
        const sorted = allChapters.sort((a, b) => b.number - a.number);
        const newChapters = [];
        for (const ch of sorted) {
            if (ch.number <= dbMax) break;
            newChapters.push(ch);
        }

        console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new (DB max: ${dbMax})`);

        const inserted = await insertChapters(manga.id, newChapters);
        return { status: 'updated', name: item.name, inserted };

    } else {
        // === NEW MANGA ===
        // Check by name first (could exist from another source)
        manga = await findMangaByName(item.name);

        if (manga) {
            // Name match → append source URL
            const linkedMax = parseFloat(manga.chapter_1) || 0;
            console.log(`  [~] Name match found: id=${manga.id}, "${manga.name}", chapter_1=${linkedMax}`);
            await appendSourceUrl(manga.id, manga.from_manga18fx, sourceUrl);

            // Fetch full chapter list via parser
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await siteParser.getFullChapterList(sourceUrl);

            // Keep only chapters newer than chapter_1
            const sorted = allChapters.sort((a, b) => b.number - a.number);
            const newChapters = [];
            for (const ch of sorted) {
                if (ch.number <= linkedMax) break;
                newChapters.push(ch);
            }

            console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new (DB max: ${linkedMax})`);

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

            // Download & resize cover image
            if (info.coverUrl) {
                try {
                    const slug = base.generateSlug(info.name || item.name);
                    await downloadAndProcessCover(info.coverUrl, slug);
                } catch (err) {
                    console.error(`  [!] Cover download failed: ${err.message}`);
                }
            }

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
async function crawlSite(parserName, options = {}) {
    const siteParser = getParserByName(parserName);
    console.log(`=== Crawl: ${siteParser.name} (${siteParser.baseUrl}) ===`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    // Get URLs to crawl (paginated or single baseUrl)
    const urls = siteParser.getHomepageUrls
        ? siteParser.getHomepageUrls(options.pages)
        : [siteParser.baseUrl];

    const items = [];
    for (let i = 0; i < urls.length; i++) {
        console.log(`[Page ${i + 1}/${urls.length}] ${urls[i]}`);
        const html = await base.fetchPage(urls[i]);
        const pageItems = siteParser.parseHomepage(html);
        console.log(`  Found ${pageItems.length} manga\n`);
        items.push(...pageItems);
    }

    console.log(`Total: ${items.length} manga from ${urls.length} page(s)\n`);

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
async function crawlAll(options = {}) {
    const allResults = {};
    for (const siteParser of getAllParsers()) {
        allResults[siteParser.name] = await crawlSite(siteParser.name, options);
    }
    return allResults;
}

// --------------- Chapter Pages Crawl ---------------

/**
 * Insert page images as external URLs for a chapter
 */
async function insertExternalPages(chapterId, imageUrls) {
    if (imageUrls.length === 0) return 0;

    const values = imageUrls.map((url, i) => [
        chapterId,
        String(i + 1).padStart(3, '0'), // slug: 001, 002, ...
        url,
        1, // external = 1
    ]);

    const [result] = await db.query(
        'INSERT IGNORE INTO page (chapter_id, slug, image, external) VALUES ?',
        [values]
    );

    return result.affectedRows;
}

/**
 * Publish chapter: set is_show = 1 + sync manga denormalized fields + invalidate cache
 */
async function publishChapter(chapterId, mangaId) {
    await db.query('UPDATE chapter SET is_show = 1 WHERE id = ?', [chapterId]);

    // Sync manga latest chapter info
    const [rows] = await db.query(
        `SELECT number, slug, created_at FROM chapter
         WHERE manga_id = ? AND is_show = 1
         ORDER BY CAST(number AS DECIMAL(10,2)) DESC, id DESC LIMIT 1`,
        [mangaId]
    );
    if (rows.length > 0) {
        const ch = rows[0];
        await db.query(
            `UPDATE manga SET chapter_1 = ?, chap_1_slug = ?, time_chap_1 = UNIX_TIMESTAMP(), update_at = UNIX_TIMESTAMP() WHERE id = ?`,
            [parseFloat(ch.number) || 0, ch.slug, mangaId]
        );
    }

    // Invalidate caches
    const [[manga]] = await db.query('SELECT slug FROM manga WHERE id = ?', [mangaId]);
    if (manga) {
        cacheDelPrefix(`manga:detail:${manga.slug}`);
        cacheDelPrefix(`chapters:${manga.slug}`);
    }
    cacheDelPrefix('newest:');
    cacheDelPrefix('hotNewReleases:');
    cacheDelPrefix('browse:');
}

/**
 * Crawl chapter pages for all unpublished chapters (is_show = 0, has source_url)
 * Uses is_crawling = 1 as lock to prevent duplicate processing by concurrent crons
 * Flow: lock → get page images → insert as external → publish → unlock
 */
async function crawlChapterPages(options = {}) {
    const limit = options.limit || 50;
    const mangaId = options.mangaId || null;

    let query = `SELECT c.id, c.manga_id, c.name, c.number, c.source_url, m.name as manga_name
                 FROM chapter c
                 JOIN manga m ON c.manga_id = m.id
                 WHERE c.is_show = 0 AND c.is_crawling = 0 AND c.source_url != ''`;
    const params = [];

    if (mangaId) {
        query += ' AND c.manga_id = ?';
        params.push(mangaId);
    }

    query += ' ORDER BY c.manga_id ASC, c.number ASC LIMIT ?';
    params.push(limit);

    const [chapters] = await db.query(query, params);
    console.log(`Found ${chapters.length} unpublished chapters to crawl\n`);

    const results = { success: 0, failed: 0, skipped: 0 };

    for (const ch of chapters) {
        try {
            // Double-check: re-select to see if another process grabbed it
            const [[fresh]] = await db.query(
                'SELECT is_crawling, is_show FROM chapter WHERE id = ?', [ch.id]
            );
            if (!fresh || fresh.is_crawling === 1 || fresh.is_show === 1) {
                console.log(`  [=] Ch.${ch.number} (id=${ch.id}): already being crawled or published, skipping`);
                results.skipped++;
                continue;
            }

            // Lock: set is_crawling = 1
            await db.query('UPDATE chapter SET is_crawling = 1 WHERE id = ?', [ch.id]);

            // Detect parser from source_url
            const siteParser = getParser(ch.source_url);

            if (!siteParser.getPageImages) {
                console.log(`  [!] ${ch.manga_name} Ch.${ch.number}: parser "${siteParser.name}" has no getPageImages, skipping`);
                await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]);
                results.failed++;
                continue;
            }

            console.log(`[*] ${ch.manga_name} — Ch.${ch.number} (id=${ch.id})`);

            // Get page images from source
            const images = await siteParser.getPageImages(ch.source_url);
            if (images.length === 0) {
                console.log(`  [!] No images found, skipping`);
                await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]);
                results.failed++;
                continue;
            }

            // Insert pages as external
            const inserted = await insertExternalPages(ch.id, images);
            console.log(`  [+] Inserted ${inserted} pages`);

            // Publish chapter (is_show = 1 + sync manga) and unlock
            await publishChapter(ch.id, ch.manga_id);
            await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]);
            console.log(`  [+] Published`);

            results.success++;
        } catch (err) {
            console.error(`  [!] Error Ch.${ch.number} (id=${ch.id}): ${err.message}`);
            // Unlock on error so it can be retried
            await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]).catch(() => {});
            results.failed++;
        }
    }

    console.log(`\n=== Chapter Pages Summary ===`);
    console.log(`Success: ${results.success}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed:  ${results.failed}`);

    return results;
}

module.exports = {
    crawlSite,
    crawlAll,
    processManga,
    crawlChapterPages,
    publishChapter,
    findMangaBySource,
    findMangaByName,
    getMaxChapterNumber,
    insertChapters,
    insertManga,
    updateMangaDenormalized,
};
