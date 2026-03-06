#!/usr/bin/env node
/**
 * Re-crawl cover images for xtoon365 manga
 * Fetch detail page → extract cover URL → download → save as {id}.jpg + {id}-thumb.jpg
 *
 * Usage:
 *   node crawler/run-recrawl-covers.js              # All xtoon365
 *   node crawler/run-recrawl-covers.js --limit 50  # Limit
 *   node crawler/run-recrawl-covers.js --id 123    # Specific manga by DB id
 *   node crawler/run-recrawl-covers.js --force     # Re-download even if files exist
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const db = require('../config/database');
const { withProxy } = require('./proxy');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COVER_SAVE_DIR = process.env.COVER_SAVE_DIR || path.join(__dirname, '../../public/cover');
const CONCURRENCY = 5;

// --------------- Args ---------------

function parseArgs() {
    const args = process.argv.slice(2);
    const idIdx = args.indexOf('--id');
    const limitIdx = args.indexOf('--limit');
    return {
        id: idIdx !== -1 ? parseInt(args[idIdx + 1], 10) : null,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null,
        force: args.includes('--force'),
    };
}

// --------------- DB ---------------

async function getMangaList({ id, limit, force }) {
    if (id) {
        const [rows] = await db.query(
            'SELECT id, slug, from_manga18fx FROM manga WHERE id = ?',
            [id]
        );
        return rows;
    }

    let query = `SELECT id, slug, from_manga18fx FROM manga
                 WHERE (from_manga18fx LIKE '%xtoon365.com%' OR from_manga18fx LIKE '%xtoon33.com%')
                 ORDER BY id ASC`;

    if (limit) query += ` LIMIT ${parseInt(limit, 10)}`;

    const [rows] = await db.query(query);

    if (!force) {
        // Skip manga that already have both cover files
        return rows.filter(m => !coverExists(m.id));
    }

    return rows;
}

// --------------- Cover helpers ---------------

function coverPath(id) {
    return {
        full:  path.join(COVER_SAVE_DIR, `${id}.jpg`),
        thumb: path.join(COVER_SAVE_DIR, `${id}-thumb.jpg`),
    };
}

function coverExists(id) {
    const { full, thumb } = coverPath(id);
    return fs.existsSync(full) && fs.existsSync(thumb);
}

async function downloadToBuffer(url, referer, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const headers = { 'User-Agent': USER_AGENT };
            if (referer) headers['Referer'] = referer;
            const res = await fetch(url, withProxy({ headers }));
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            if (res.status === 403 || res.status === 429 || res.status >= 500) {
                lastErr = new Error(`HTTP ${res.status}`);
                if (i < retries - 1) await sleep(1000 * (i + 1));
                continue;
            }
            throw new Error(`HTTP ${res.status} for ${url}`);
        } catch (err) {
            lastErr = err;
            if (i < retries - 1) await sleep(1000 * (i + 1));
        }
    }
    throw new Error(`${lastErr.message} (after ${retries} retries)`);
}

async function saveCover(buffer, id) {
    fs.mkdirSync(COVER_SAVE_DIR, { recursive: true });
    const { full, thumb } = coverPath(id);

    await Promise.all([
        sharp(buffer).flatten({ background: '#ffffff' }).resize(600).jpeg({ quality: 85 }).toFile(full),
        sharp(buffer).flatten({ background: '#ffffff' }).resize(300).jpeg({ quality: 80 }).toFile(thumb),
    ]);

    const fullSize  = fs.statSync(full).size;
    const thumbSize = fs.statSync(thumb).size;
    console.log(`  [+] ${id}.jpg (${Math.round(fullSize/1024)}KB) + ${id}-thumb.jpg (${Math.round(thumbSize/1024)}KB)`);
}

// --------------- Xtoon detail page ---------------

/**
 * Lấy URL xtoon từ from_manga18fx (comma-separated)
 * VD: "https://t1.xtoon365.com/comic/847551,https://www.mangaupdates.com/..."
 */
function extractXtoonUrl(fromManga18fx) {
    if (!fromManga18fx) return null;
    const parts = fromManga18fx.split(',').map(s => s.trim());
    return parts.find(u => u.includes('xtoon365.com') || u.includes('xtoon33.com')) || null;
}

async function fetchCoverUrl(xtoonUrl, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(xtoonUrl, withProxy({
                headers: { 'User-Agent': USER_AGENT },
            }));
            if (res.ok) {
                const html = await res.text();
                const $ = cheerio.load(html);
                const coverUrl = $('.toon-img img').attr('src') || '';
                return coverUrl || null;
            }
            if (res.status === 403 || res.status === 429 || res.status >= 500) {
                lastErr = new Error(`HTTP ${res.status}`);
                if (i < retries - 1) await sleep(1000 * (i + 1));
                continue;
            }
            throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastErr = err;
            if (i < retries - 1) await sleep(1000 * (i + 1));
        }
    }
    throw new Error(`${lastErr.message} (after ${retries} retries)`);
}

// --------------- Main ---------------

async function main() {
    const { id, limit, force } = parseArgs();

    console.log(`=== Re-crawl Covers (xtoon365) ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    if (force) console.log(`[FORCE] Re-download even if files exist`);
    console.log('');

    const mangaList = await getMangaList({ id, limit, force });
    console.log(`Found ${mangaList.length} manga to process\n`);

    if (mangaList.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    const results = { success: 0, skipped: 0, failed: 0 };
    const total = mangaList.length;

    async function processOne(manga, idx) {
        const prefix = `[${idx + 1}/${total}] id=${manga.id}`;

        const xtoonUrl = extractXtoonUrl(manga.from_manga18fx);
        if (!xtoonUrl) {
            console.log(`${prefix} — no xtoon URL, skipping`);
            results.skipped++;
            return;
        }

        console.log(`${prefix} ${xtoonUrl}`);

        try {
            const coverUrl = await fetchCoverUrl(xtoonUrl);
            if (!coverUrl) {
                console.log(`  [x] No cover URL found on detail page`);
                results.failed++;
                return;
            }

            console.log(`  [>] Cover: ${coverUrl}`);
            const referer = new URL(xtoonUrl).origin;
            const buffer = await downloadToBuffer(coverUrl, referer);
            await saveCover(buffer, manga.id);
            results.success++;
        } catch (err) {
            console.error(`  [!] Error: ${err.message}`);
            results.failed++;
        }
    }

    for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = mangaList.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((manga, j) => processOne(manga, i + j)));
    }

    console.log(`\n=== Summary ===`);
    console.log(`Success: ${results.success}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed:  ${results.failed}`);

    process.exit(0);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
    console.error('[!] Fatal:', err);
    process.exit(1);
});
