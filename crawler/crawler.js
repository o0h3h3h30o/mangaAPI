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
    // Exact match or match as comma-separated item
    const [rows] = await db.query(
        `SELECT id, name, slug, from_manga18fx, chapter_1 FROM manga
         WHERE from_manga18fx = ? OR FIND_IN_SET(?, REPLACE(from_manga18fx, ', ', ',')) > 0
         LIMIT 1`,
        [sourceUrl, sourceUrl]
    );
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Find manga by name (exact or FULLTEXT)
 */
async function findMangaByName(name) {
    const [rows] = await db.query(
        'SELECT id, name, slug, from_manga18fx, chapter_1 FROM manga WHERE name = ? LIMIT 1',
        [name]
    );
    return rows.length > 0 ? rows[0] : null;
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

/**
 * Get all existing chapter numbers for a manga (as Set of floats)
 */
/**
 * Returns a Set of existing chapter numbers for a manga, normalized to a
 * canonical "X.YY" string so that float precision and DECIMAL(10,2)
 * round-trips line up reliably with the unique key on (manga_id, number).
 */
async function getExistingChapterNumbers(mangaId) {
    const [rows] = await db.query(
        'SELECT number as num FROM chapter WHERE manga_id = ?',
        [mangaId]
    );
    return new Set(rows.map(r => normalizeChapterNumber(r.num)));
}

/**
 * Returns a Set of existing chapter slugs for a manga — used as a safety
 * net for the unique constraint that may exist on slug as well.
 */
async function getExistingChapterSlugs(mangaId) {
    const [rows] = await db.query(
        'SELECT slug FROM chapter WHERE manga_id = ? AND slug IS NOT NULL AND slug != ""',
        [mangaId]
    );
    return new Set(rows.map(r => r.slug));
}

/**
 * Normalize chapter number to canonical "X.YY" string. Handles:
 *   - mysql2 returning DECIMAL as string ("134.50")
 *   - parser returning float (134.5)
 *   - parser returning integer (134)
 *   - float precision noise (134.50000001 → "134.50")
 */
function normalizeChapterNumber(value) {
    if (value === null || value === undefined) return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toFixed(2);  // matches DECIMAL(10,2) precision
}

/**
 * Check if a chapter name already exists for a manga
 */
async function chapterNameExists(mangaId, chapterName) {
    if (!chapterName) return false;
    const [rows] = await db.query(
        'SELECT id FROM chapter WHERE manga_id = ? AND name = ? LIMIT 1',
        [mangaId, chapterName]
    );
    return rows.length > 0;
}

/**
 * Get all existing chapter source_urls for a manga (as Set)
 */
async function getExistingChapterUrls(mangaId) {
    const [rows] = await db.query(
        'SELECT source_url FROM chapter WHERE manga_id = ? AND source_url IS NOT NULL AND source_url != ""',
        [mangaId]
    );
    return new Set(rows.map(r => r.source_url));
}

// --------------- DB Writes ---------------

/**
 * Strip 4-byte Unicode characters (emoji, etc.) that MySQL utf8 (3-byte) rejects.
 * Use utf8mb4 on the DB column to avoid this, or call this before inserting.
 */
function stripEmoji(str) {
    if (!str) return str;
    return str.replace(/[\u{10000}-\u{10FFFF}]/gu, '');
}

/**
 * Map status text → status_id (1=ongoing, 2=completed)
 */
function mapStatusId(status) {
    if (status === 'completed') return 2;
    return 1; // ongoing by default
}

/**
 * Find or create comictype by label, return type_id
 */
async function findOrCreateType(tipo) {
    if (!tipo) return null;
    const label = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase(); // "manhwa" → "Manhwa"
    const [rows] = await db.query('SELECT id FROM comictype WHERE label = ? LIMIT 1', [label]);
    if (rows.length > 0) return rows[0].id;

    const [result] = await db.query('INSERT INTO comictype (label) VALUES (?)', [label]);
    console.log(`    [+] Created comictype: "${label}" (id=${result.insertId})`);
    return result.insertId;
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
    let slug = base.generateSlug(data.slugName || data.name);
    const statusId = mapStatusId(data.status);
    const typeId = await findOrCreateType(data.tipo);

    const [result] = await db.query(
        `INSERT INTO manga (name, slug, summary, otherNames, from_manga18fx, status_id, type_id, is_public, caution, created_at, updated_at, create_at, update_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
        [
            stripEmoji(data.name),
            slug || '__temp__',
            stripEmoji(data.description || ''),
            stripEmoji(data.otherNames || ''),
            data.sourceUrl || '',
            statusId,
            typeId,
            data.caution ? 1 : 0,
        ]
    );

    const mangaId = result.insertId;

    // If slug is empty (e.g. Korean/CJK name), use mangaId as slug
    if (!slug) {
        slug = String(mangaId);
        await db.query('UPDATE manga SET slug = ? WHERE id = ?', [slug, mangaId]);
    }

    console.log(`  [+] Inserted manga: "${data.name}" (id=${mangaId}, slug=${slug})`);

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
async function insertChapters(mangaId, chapters, siteParser = null) {
    if (chapters.length === 0) return 0;

    // Safety filter: drop chapters whose source_url, number, or slug is
    // already in DB. The DB has a unique constraint on (manga_id, number)
    // and INSERT IGNORE silently skips conflicts — without these filters
    // the affectedRows count is misleading.
    const existingUrls = await getExistingChapterUrls(mangaId);
    const existingNums = await getExistingChapterNumbers(mangaId);
    const existingSlugs = await getExistingChapterSlugs(mangaId);
    const filtered = chapters.filter(ch => {
        if (ch.url && existingUrls.has(ch.url)) return false;
        if (existingNums.has(normalizeChapterNumber(ch.number))) return false;
        const slug = base.generateChapterSlug(ch.number);
        if (existingSlugs.has(slug)) return false;
        return true;
    });
    if (filtered.length === 0) {
        console.log(`  [=] All ${chapters.length} chapters already exist, nothing to insert`);
        return 0;
    }
    if (filtered.length < chapters.length) {
        console.log(`  [~] Filtered out ${chapters.length - filtered.length} duplicate chapters`);
    }

    // Normalize chapter timestamp into MySQL DATETIME format
    // ("YYYY-MM-DD HH:MM:SS"). Anything else — including JS Date.toISOString()
    // ("2026-04-30T12:34:56.789Z") — is rejected silently by MySQL when
    // sql_mode includes STRICT_TRANS_TABLES, which makes INSERT IGNORE drop
    // the row without surfacing an error.
    const toMysqlDatetime = (dateStr) => {
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) =>
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

        if (!dateStr) return fmt(new Date());
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            // date-only "2026-01-01" → append current local time
            return `${dateStr} ${new Date().toTimeString().slice(0, 8)}`;
        }
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
            return dateStr; // already MySQL-formatted
        }
        // ISO 8601 ("...T...Z") or other formats Date can parse → reformat
        const d = new Date(dateStr);
        if (!Number.isNaN(d.getTime())) return fmt(d);
        // Last-ditch fallback: now() rather than risk silent drop
        return fmt(new Date());
    };

    const values = filtered.map(ch => {
        const ts = toMysqlDatetime(ch.created_at);
        return [
            mangaId,
            ch.title || (siteParser.formatChapterTitle ? siteParser.formatChapterTitle(ch.number) : `第${ch.number}話`),
            base.generateChapterSlug(ch.number),
            ch.number,
            0,  // is_show = 0
            ch.url || '',
            ts,
            ts,
        ];
    });

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flat = values.flat();

    const [result] = await db.query(
        `INSERT IGNORE INTO chapter (manga_id, name, slug, number, is_show, source_url, created_at, updated_at)
         VALUES ${placeholders}`,
        flat
    );

    console.log(`  [+] Inserted ${result.affectedRows}/${filtered.length} chapters for manga id=${mangaId}`);
    if (result.affectedRows < filtered.length) {
        // INSERT IGNORE turned errors into warnings. Pull them so we know
        // *exactly* what MySQL didn't like (unique key, FK, NOT NULL,
        // truncation, bad date, …).
        let warningRows = [];
        try {
            const [warns] = await db.query('SHOW WARNINGS');
            warningRows = warns || [];
        } catch (e) {
            // Some hosts strip SHOW WARNINGS — non-fatal.
        }

        console.log(`  [~] DB silently dropped ${filtered.length - result.affectedRows} chapters`);
        // Show the row we tried to insert AND verify whether DB already has
        // it under the same (manga_id, number/slug) — if it does, the JS
        // filter missed the dedup; if not, we're hitting a *different*
        // constraint and the SHOW WARNINGS output explains why.
        for (const ch of filtered) {
            const slug = base.generateChapterSlug(ch.number);
            const normNum = normalizeChapterNumber(ch.number);
            const inSet = existingNums.has(normNum);
            const slugInSet = existingSlugs.has(slug);
            // Re-query DB directly for this exact (manga_id, number) to be sure
            const [dbHit] = await db.query(
                'SELECT id, number, slug, source_url, is_show FROM chapter WHERE manga_id = ? AND number = ? LIMIT 1',
                [mangaId, ch.number]
            );
            console.log(
                `       attempted: number=${ch.number} (norm="${normNum}"), ` +
                `slug="${slug}", url="${(ch.url || '').slice(0, 80)}", ` +
                `inExistingNums=${inSet}, inExistingSlugs=${slugInSet}, dbRow=${dbHit?.[0] ? JSON.stringify(dbHit[0]) : 'none'}`
            );
        }
        // Sample of existingNums set so we can eyeball normalisation
        const sampleNums = [...existingNums].slice(-5);
        console.log(`       existingNums tail (last 5): ${JSON.stringify(sampleNums)}`);
        for (const w of warningRows.slice(0, 5)) {
            console.log(`       MySQL ${w.Level}: [${w.Code}] ${w.Message}`);
        }
    }
    return result.affectedRows;
}

/**
 * Update denormalized chapter fields on manga table
 */
async function updateMangaDenormalized(mangaId) {
    const [rows] = await db.query(
        `SELECT number, slug, name, created_at FROM chapter
         WHERE manga_id = ? AND is_show = 1
         ORDER BY number DESC, id DESC LIMIT 2`,
        [mangaId]
    );

    if (rows.length === 0) return;

    const ch1 = rows[0];
    const ch2 = rows[1] || null;

    const now = Math.floor(Date.now() / 1000);
    const toUnix = (d) => {
        const ts = Math.floor(new Date(d).getTime() / 1000);
        return isNaN(ts) ? now : ts;
    };

    const timeChap1 = toUnix(ch1.created_at);
    const updates = {
        chapter_1: ch1.number,
        chap_1_slug: ch1.slug,
        time_chap_1: timeChap1,
        update_at: timeChap1,
    };

    if (ch2) {
        updates.chapter_2 = ch2.number;
        updates.chap_2_slug = ch2.slug;
        updates.time_chap_2 = toUnix(ch2.created_at);
    }

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(updates);

    await db.query(`UPDATE manga SET ${sets} WHERE id = ?`, [...vals, mangaId]);
}

/**
 * Sync manga update_at from newest chapter's created_at
 * Used by xtoon365 so manga sort order matches chapter publish dates
 */
async function syncMangaTimeFromChapter(mangaId) {
    await db.query(
        `UPDATE manga SET update_at = (
            SELECT UNIX_TIMESTAMP(MAX(created_at)) FROM chapter WHERE manga_id = ?
        ) WHERE id = ?`,
        [mangaId, mangaId]
    );
    console.log(`  [~] Synced manga update_at from newest chapter`);
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
        console.log(`  [=] Found in DB: id=${manga.id}, slug=${manga.slug}, chapter_1=${manga.chapter_1}`);

        // Check if latest chapter from homepage already exists in DB (by name)
        const latestText = item.latestChapterText || '';
        if (latestText) {
            const exists = await chapterNameExists(manga.id, latestText);
            if (exists) {
                console.log(`  [=] Latest chapter "${latestText}" already in DB, skipping`);
                return { status: 'skipped', name: item.name };
            }
            console.log(`  [>] Chapter "${latestText}" not in DB, fetching detail...`);
        }

        // Fetch full chapter list via parser
        console.log(`  [>] Fetching full chapter list...`);
        const allChapters = await siteParser.getFullChapterList(sourceUrl);

        // Filter out chapters whose source_url already exists in DB
        const existingUrls = await getExistingChapterUrls(manga.id);
        const newChapters = allChapters.filter(ch => !existingUrls.has(ch.url));

        console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

        const inserted = await insertChapters(manga.id, newChapters, siteParser);
        return { status: 'updated', name: item.name, inserted };

    } else {
        // === NEW MANGA ===
        // Check by name first (could exist from another source)
        manga = await findMangaByName(item.name);

        if (manga) {
            // Name match → append source URL
            console.log(`  [~] Name match found: id=${manga.id}, "${manga.name}", chapter_1=${manga.chapter_1}`);
            await appendSourceUrl(manga.id, manga.from_manga18fx, sourceUrl);

            // Fetch full chapter list via parser
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await siteParser.getFullChapterList(sourceUrl);

            // Filter out chapters whose source_url already exists in DB
            const existingUrls = await getExistingChapterUrls(manga.id);
            const newChapters = allChapters.filter(ch => !existingUrls.has(ch.url));

            console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

            const inserted = await insertChapters(manga.id, newChapters, siteParser);
            if (inserted > 0) {
                await syncMangaTimeFromChapter(manga.id);
            }
            return { status: 'linked', name: item.name, mangaId: manga.id, inserted };

        } else {
            // Brand new manga → fetch detail page for info
            console.log(`  [+] New manga, fetching detail...`);
            const detailHtml = await base.fetchPage(sourceUrl);
            const info = siteParser.extractMangaInfo(detailHtml);
            if (info.skip) {
                console.log(`  [~] Skipped (Korean-only name: "${info.name}")`);
                return { status: 'skipped', name: item.name };
            }
            console.log(`  [+] Parsed: "${info.name}", genres=[${info.genres.join(', ')}], status=${info.status}${info.caution ? ', 19+' : ''}`);

            // Re-check by parsed name: homepage card name ("single"/localized) may differ
            // from detail page name → avoid creating a duplicate manga.
            if (info.name && info.name !== item.name) {
                const byParsedName = await findMangaByName(info.name);
                if (byParsedName) {
                    console.log(`  [~] Name match (parsed): id=${byParsedName.id}, "${byParsedName.name}", chapter_1=${byParsedName.chapter_1}`);
                    await appendSourceUrl(byParsedName.id, byParsedName.from_manga18fx, sourceUrl);

                    console.log(`  [>] Fetching full chapter list...`);
                    const allChapters = await siteParser.getFullChapterList(sourceUrl);

                    const existingUrls = await getExistingChapterUrls(byParsedName.id);
                    const newChapters = allChapters.filter(ch => !existingUrls.has(ch.url));
                    console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

                    const inserted = await insertChapters(byParsedName.id, newChapters, siteParser);
                    if (inserted > 0) {
                        await syncMangaTimeFromChapter(byParsedName.id);
                    }
                    return { status: 'linked', name: info.name, mangaId: byParsedName.id, inserted };
                }
            }

            const mangaId = await insertManga({
                name: info.name || item.name,
                slugName: info.slugName || item.name,
                description: info.description,
                otherNames: info.otherNames,
                authors: info.authors,
                status: info.status,
                tipo: info.tipo,
                genres: info.genres,
                caution: info.caution || false,
                sourceUrl: sourceUrl,
            });

            // Download & resize cover image → saved as {id}.jpg + {id}-thumb.jpg
            if (info.coverUrl) {
                try {
                    const referer = new URL(sourceUrl).origin;
                    await downloadAndProcessCover(info.coverUrl, String(mangaId), referer);
                } catch (err) {
                    console.error(`  [!] Cover download failed: ${err.message}`);
                }
            }

            // Fetch full chapter list via parser
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await siteParser.getFullChapterList(sourceUrl);
            console.log(`  [>] Found ${allChapters.length} chapters`);

            const inserted = await insertChapters(mangaId, allChapters, siteParser);
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
        ? siteParser.getHomepageUrls(options.pages, options.url, options.startPage)
        : [siteParser.baseUrl];

    const results = { skipped: 0, updated: 0, created: 0, linked: 0, errors: 0 };

    // --limit N: stop after processing N manga total. Useful for debugging
    // a single problematic manga without crawling the whole homepage.
    const limit = Number.isFinite(options.limit) && options.limit > 0
        ? options.limit
        : null;
    let processed = 0;

    pageLoop:
    for (let i = 0; i < urls.length; i++) {
        console.log(`[Page ${i + 1}/${urls.length}] ${urls[i]}`);
        const html = await base.fetchPage(urls[i]);
        let pageItems = siteParser.parseHomepage(html);
        console.log(`  Found ${pageItems.length} manga\n`);

        if (limit !== null) pageItems = pageItems.slice(0, limit - processed);

        const CONCURRENCY = limit === 1 ? 1 : 2;
        for (let j = 0; j < pageItems.length; j += CONCURRENCY) {
            const batch = pageItems.slice(j, j + CONCURRENCY);
            await Promise.all(batch.map(async (item) => {
                try {
                    const result = await processManga(item);
                    results[result.status] = (results[result.status] || 0) + 1;
                } catch (err) {
                    console.error(`  [!] Error processing "${item.name}":`, err.message);
                    results.errors++;
                }
            }));
            processed += batch.length;
            if (limit !== null && processed >= limit) {
                console.log(`  [stop] reached --limit ${limit}, exiting`);
                break pageLoop;
            }
        }

        console.log(`  [Page ${i + 1} done] Created: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors}\n`);
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
 * Download an image with Referer header, return Buffer
 */
async function downloadImage(imageUrl, referer) {
    const { withProxy } = require('./proxy');
    const res = await fetch(imageUrl, withProxy({
        headers: {
            'User-Agent': base.USER_AGENT,
            'Referer': referer,
        },
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Download page images to local directory and insert into DB
 * Downloads 5 images concurrently for speed
 */
async function downloadAndInsertPages(chapterId, imageUrls, referer, outputDir) {
    const fs = require('fs');
    const path = require('path');

    if (imageUrls.length === 0) return 0;

    const chapterDir = path.join(outputDir, String(chapterId));
    fs.mkdirSync(chapterDir, { recursive: true });

    // Prepare tasks
    const tasks = imageUrls.map((url, i) => {
        const slug = String(i + 1).padStart(3, '0');
        const ext = (url.match(/\.(jpe?g|png|webp|gif)/i) || [, 'jpg'])[1];
        const filename = `${slug}.${ext}`;
        return { url, slug, filename, filepath: path.join(chapterDir, filename) };
    });

    // Download concurrently (10 at a time)
    const CONCURRENCY = 10;
    const values = new Array(tasks.length);
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (task, j) => {
            const buffer = await downloadImage(task.url, referer);
            fs.writeFileSync(task.filepath, buffer);
            values[i + j] = [chapterId, task.slug, task.filename, 0];
        }));
    }

    const [result] = await db.query(
        'INSERT IGNORE INTO page (chapter_id, slug, image, external) VALUES ?',
        [values]
    );
    return result.affectedRows;
}

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

    // Sync manga denormalized fields (chapter_1, chapter_2, update_at, etc.)
    await updateMangaDenormalized(mangaId);

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
    const orderBy = options.orderBy || 'c.manga_id ASC, c.number ASC';
    const outputDir = options.outputDir || null; // local download path

    let query = `SELECT c.id, c.manga_id, c.name, c.number, c.source_url, m.name as manga_name
                 FROM chapter c
                 JOIN manga m ON c.manga_id = m.id
                 WHERE c.is_show = 0 AND c.is_crawling = 0 AND c.source_url != ''`;
    const params = [];

    if (mangaId) {
        query += ' AND c.manga_id = ?';
        params.push(mangaId);
    }

    query += ` ORDER BY ${orderBy} LIMIT ?`;
    params.push(limit);

    const [chapters] = await db.query(query, params);
    console.log(`Found ${chapters.length} unpublished chapters to crawl\n`);

    const results = { success: 0, failed: 0, skipped: 0 };
    const CHAPTER_CONCURRENCY = 10;

    async function processOneChapter(ch) {
        try {
            // Double-check: re-select to see if another process grabbed it
            const [[fresh]] = await db.query(
                'SELECT is_crawling, is_show FROM chapter WHERE id = ?', [ch.id]
            );
            if (!fresh || fresh.is_crawling === 1 || fresh.is_show === 1) {
                console.log(`  [=] Ch.${ch.number} (id=${ch.id}): already being crawled or published, skipping`);
                results.skipped++;
                return;
            }

            // Lock: set is_crawling = 1
            await db.query('UPDATE chapter SET is_crawling = 1 WHERE id = ?', [ch.id]);

            // Detect parser from source_url
            const siteParser = getParser(ch.source_url);

            if (!siteParser.getPageImages) {
                console.log(`  [!] ${ch.manga_name} Ch.${ch.number}: parser "${siteParser.name}" has no getPageImages, skipping`);
                await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]);
                results.failed++;
                return;
            }

            console.log(`[*] ${ch.manga_name} — Ch.${ch.number} (id=${ch.id})`);

            // Get page images from source
            const images = await siteParser.getPageImages(ch.source_url);
            if (images.length === 0) {
                console.log(`  [!] No images found, marking as failed`);
                results.failed++;
                return;
            }

            // Download locally or store external URLs
            let inserted;
            if (outputDir) {
                const referer = siteParser.baseUrl || new URL(ch.source_url).origin;
                inserted = await downloadAndInsertPages(ch.id, images, referer, outputDir);
                console.log(`  [+] Downloaded ${inserted} pages to ${outputDir}/${ch.id}/`);
            } else {
                inserted = await insertExternalPages(ch.id, images);
                console.log(`  [+] Inserted ${inserted} external pages`);
            }

            // Publish chapter (is_show = 1 + sync manga) and unlock
            await publishChapter(ch.id, ch.manga_id);
            await db.query('UPDATE chapter SET is_crawling = 0 WHERE id = ?', [ch.id]);
            console.log(`  [+] Published`);

            results.success++;
        } catch (err) {
            console.error(`  [!] Error Ch.${ch.number} (id=${ch.id}): ${err.message}`);
            // Keep is_crawling = 1 so it won't be retried (source page likely gone)
            results.failed++;
        }
    }

    // Process chapters in batches of CHAPTER_CONCURRENCY
    for (let i = 0; i < chapters.length; i += CHAPTER_CONCURRENCY) {
        const batch = chapters.slice(i, i + CHAPTER_CONCURRENCY);
        await Promise.all(batch.map(ch => processOneChapter(ch)));
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
