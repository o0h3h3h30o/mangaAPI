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
 * Insert new manga record
 */
async function insertManga(data) {
    const slug = parser.generateSlug(data.name);
    const [result] = await db.query(
        `INSERT INTO manga (name, title, slug, description, otherNames, author, artist, status, from_manga18fx, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
            data.name,
            data.name,
            slug,
            data.description || '',
            data.otherNames || '',
            data.authors ? data.authors.join(', ') : '',
            data.artists ? data.artists.join(', ') : '',
            data.status || 'ongoing',
            data.sourceUrl || '',
        ]
    );
    console.log(`  [+] Inserted manga: "${data.name}" (id=${result.insertId})`);
    return result.insertId;
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

        // Has new chapters → insert from homepage data (chapters > dbMax)
        const newChapters = item.chapters.filter(ch => ch.number > dbMax);

        if (newChapters.length === 0) {
            console.log(`  [=] No new chapters from homepage listing`);
            return { status: 'skipped', name: item.name };
        }

        // TODO: Nếu cần lấy đầy đủ chapters giữa dbMax và latestChapterNum,
        // cần fetch detail page. Hiện tại chỉ insert chapters có trên homepage.
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

            // Insert new chapters
            const dbMax = await getMaxChapterNumber(manga.id);
            const newChapters = item.chapters.filter(ch => ch.number > dbMax);
            const inserted = await insertChapters(manga.id, newChapters);
            return { status: 'linked', name: item.name, mangaId: manga.id, inserted };

        } else {
            // Manga hoàn toàn mới
            console.log(`  [+] New manga, creating...`);

            const mangaId = await insertManga({
                name: item.name,
                sourceUrl: sourceUrl,
            });

            // Insert chapters from homepage
            const inserted = await insertChapters(mangaId, item.chapters);
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
