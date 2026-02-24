/**
 * Core Crawler Logic
 * Crawl homepage → check DB → insert new chapters (is_show = 0)
 */
const db = require('../config/database');
const parser = require('./parsers/jestful');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// --------------- HTTP ---------------

async function fetchPage(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

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
    const slug = parser.generateSlug(name);
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
 * Find or create an author by name, return author_id
 */
async function findOrCreateAuthor(name) {
    const slug = parser.generateSlug(name);
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
 * Insert new manga record with categories and authors
 */
async function insertManga(data) {
    const slug = parser.generateSlug(data.name);
    const statusId = mapStatusId(data.status);

    const [result] = await db.query(
        `INSERT INTO manga (name, slug, new_slug, summary, otherNames, from_manga18fx, cover, status_id, is_public, created_at, update_at, create_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
        [
            data.name,
            slug,
            slug,
            data.description || '',
            data.otherNames || '',
            data.sourceUrl || '',
            data.coverUrl || '',
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

    // Link authors
    if (Array.isArray(data.authors) && data.authors.length > 0) {
        const entries = [];
        for (const authorName of data.authors) {
            const authorId = await findOrCreateAuthor(authorName);
            entries.push([authorId, mangaId, 1]); // type=1 (author)
        }
        await db.query('INSERT IGNORE INTO author_manga (author_id, manga_id, type) VALUES ?', [entries]);
        console.log(`  [+] Linked ${entries.length} authors`);
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
        parser.generateChapterSlug(ch.number),
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
 */
async function processManga(item) {
    const sourceUrl = item.url;
    console.log(`\n[*] Processing: ${item.name} (latest: Ch.${item.latestChapterNum})`);

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

        // Fetch full chapter list via API
        console.log(`  [>] Fetching full chapter list...`);
        const allChapters = await parser.getFullChapterList(sourceUrl);
        const newChapters = allChapters.filter(ch => ch.number > dbMax);
        console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

        const inserted = await insertChapters(manga.id, newChapters);
        return { status: 'updated', name: item.name, inserted };

    } else {
        // === NEW MANGA ===
        // Check by name first (có thể đã tồn tại từ source khác)
        manga = await findMangaByName(item.name);

        if (manga) {
            // Trùng tên → append source URL
            console.log(`  [~] Name match found: id=${manga.id}, "${manga.name}"`);
            await appendSourceUrl(manga.id, manga.from_manga18fx, sourceUrl);

            // Fetch full chapter list via API
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await parser.getFullChapterList(sourceUrl);
            const dbMax = await getMaxChapterNumber(manga.id);
            const newChapters = allChapters.filter(ch => ch.number > dbMax);
            console.log(`  [>] Found ${allChapters.length} total, ${newChapters.length} new`);

            const inserted = await insertChapters(manga.id, newChapters);
            return { status: 'linked', name: item.name, mangaId: manga.id, inserted };

        } else {
            // Manga hoàn toàn mới → fetch detail page để lấy info
            console.log(`  [+] New manga, fetching detail...`);
            const detailHtml = await fetchPage(sourceUrl);
            const info = parser.extractMangaInfo(detailHtml);
            console.log(`  [+] Parsed: "${info.name}", genres=[${info.genres.join(', ')}], status=${info.status}`);

            const mangaId = await insertManga({
                name: info.name || item.name,
                description: info.description,
                otherNames: info.otherNames,
                authors: info.authors,
                status: info.status,
                coverUrl: info.coverUrl,
                genres: info.genres,
                sourceUrl: sourceUrl,
            });

            // Fetch full chapter list via API
            console.log(`  [>] Fetching full chapter list...`);
            const allChapters = await parser.getFullChapterList(sourceUrl);
            console.log(`  [>] Found ${allChapters.length} chapters`);

            const inserted = await insertChapters(mangaId, allChapters);
            return { status: 'created', name: item.name, mangaId, inserted };
        }
    }
}

/**
 * Main: crawl homepage and process all manga
 */
async function crawlHomepage() {
    console.log('=== Crawl Homepage: jestful.net ===');
    console.log(`Time: ${new Date().toISOString()}\n`);

    const html = await fetchPage(parser.BASE_URL);
    const items = parser.parseHomepage(html);

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

    console.log('\n=== Summary ===');
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Updated: ${results.updated}`);
    console.log(`Created: ${results.created}`);
    console.log(`Linked:  ${results.linked}`);
    console.log(`Errors:  ${results.errors}`);

    return results;
}

module.exports = {
    crawlHomepage,
    processManga,
    findMangaBySource,
    findMangaByName,
    getMaxChapterNumber,
    insertChapters,
    insertManga,
    updateMangaDenormalized,
    fetchPage,
};
