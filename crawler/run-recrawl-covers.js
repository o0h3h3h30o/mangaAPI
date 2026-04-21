#!/usr/bin/env node
/**
 * Re-crawl cover images for manga from various sources
 * Fetch detail page → extract cover URL → download → save as {id}.jpg + {id}-thumb.jpg
 *
 * Usage:
 *   node crawler/run-recrawl-covers.js                          # All xtoon365 (default)
 *   node crawler/run-recrawl-covers.js --source jestful         # All jestful
 *   node crawler/run-recrawl-covers.js --source raw18           # All raw18 (all domains)
 *   node crawler/run-recrawl-covers.js --source manhwaweb       # All manhwaweb
 *   node crawler/run-recrawl-covers.js --source jestful --limit 50
 *   node crawler/run-recrawl-covers.js --id 123                 # Specific manga by DB id
 *   node crawler/run-recrawl-covers.js --force                  # Re-download even if files exist
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
const CONCURRENCY = 2;

// --------------- Source configs ---------------

const SOURCES = {
    xtoon: {
        label: 'xtoon365',
        dbFilter: `(from_manga18fx LIKE '%xtoon365.com%' OR from_manga18fx LIKE '%xtoon33.com%')`,
        extractUrl(fromManga18fx) {
            if (!fromManga18fx) return null;
            const parts = fromManga18fx.split(',').map(s => s.trim());
            return parts.find(u => u.includes('xtoon365.com') || u.includes('xtoon33.com')) || null;
        },
        async fetchCoverUrl(sourceUrl) {
            const referer = new URL(sourceUrl).origin;
            const html = await fetchPage(sourceUrl, referer);
            const $ = cheerio.load(html);
            return $('.toon-img img').attr('src') || null;
        },
    },
    jestful: {
        label: 'jestful',
        dbFilter: `(from_manga18fx LIKE '%jestful.net%')`,
        extractUrl(fromManga18fx) {
            if (!fromManga18fx) return null;
            const parts = fromManga18fx.split(',').map(s => s.trim());
            return parts.find(u => u.includes('jestful.net')) || null;
        },
        async fetchCoverUrl(sourceUrl) {
            const html = await fetchPage(sourceUrl, 'https://jestful.net');
            const $ = cheerio.load(html);
            const rawUrl = $('.info-cover img.thumbnail').attr('src') || '';
            if (!rawUrl) return null;
            // Build full URL if relative
            if (rawUrl.startsWith('http')) return rawUrl;
            return `https://jestful.net/${rawUrl.replace(/^\//, '')}`;
        },
    },
    raw18: {
        label: 'raw18',
        dbFilter: `(from_manga18fx LIKE '%raw18.info%' OR from_manga18fx LIKE '%raw18.link%' OR from_manga18fx LIKE '%raw18.rest%' OR from_manga18fx LIKE '%raw18.win%' OR from_manga18fx LIKE '%raw18.cloud%')`,
        extractUrl(fromManga18fx) {
            if (!fromManga18fx) return null;
            const parts = fromManga18fx.split(',').map(s => s.trim());
            return parts.find(u => /raw18\.(?:info|link|rest|win|cloud)/.test(u)) || null;
        },
        async fetchCoverUrl(sourceUrl) {
            // Normalize legacy domains → raw18.cloud (current)
            const url = sourceUrl.replace(/raw18\.(?:info|link|rest|win)/, 'raw18.cloud');
            const html = await fetchPage(url, 'https://raw18.cloud');
            const $ = cheerio.load(html);
            const coverUrl = $('div.detail-info img[src*="admin.raw18"]').first().attr('src')
                || $('div.col-image img[src]').first().attr('src')
                || $('img[src*="admin.raw18"]').first().attr('src')
                || null;
            return coverUrl ? coverUrl.trim() : null;
        },
    },
    manhwaweb: {
        label: 'manhwaweb',
        dbFilter: `(from_manga18fx LIKE '%manhwaweb.com%' OR from_manga18fx LIKE '%manhwawebbackend-production.up.railway.app%')`,
        extractUrl(fromManga18fx) {
            if (!fromManga18fx) return null;
            const parts = fromManga18fx.split(',').map(s => s.trim());
            return parts.find(u => u.includes('manhwaweb.com') || u.includes('manhwawebbackend-production.up.railway.app')) || null;
        },
        async fetchCoverUrl(sourceUrl) {
            // manhwaweb exposes a JSON detail API — cover is at data._imagen
            const res = await fetch(sourceUrl, withProxy({
                headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://manhwaweb.com' },
            }));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data._imagen || null;
        },
    },
};

// --------------- Args ---------------

function parseArgs() {
    const args = process.argv.slice(2);
    const idIdx = args.indexOf('--id');
    const limitIdx = args.indexOf('--limit');
    const sourceIdx = args.indexOf('--source');
    return {
        id: idIdx !== -1 ? parseInt(args[idIdx + 1], 10) : null,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null,
        source: sourceIdx !== -1 ? args[sourceIdx + 1] : 'xtoon',
        force: args.includes('--force'),
    };
}

// --------------- DB ---------------

async function getMangaList({ id, limit, force }, sourceConfig) {
    if (id) {
        const [rows] = await db.query(
            'SELECT id, slug, from_manga18fx FROM manga WHERE id = ?',
            [id]
        );
        return rows;
    }

    let query = `SELECT id, slug, from_manga18fx FROM manga
                 WHERE ${sourceConfig.dbFilter}
                 ORDER BY id ASC`;

    if (limit) query += ` LIMIT ${parseInt(limit, 10)}`;

    const [rows] = await db.query(query);

    if (!force) {
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

async function fetchPage(url, referer, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const headers = { 'User-Agent': USER_AGENT };
            if (referer) headers['Referer'] = referer;
            const res = await fetch(url, withProxy({
                headers,
                signal: ctrl.signal,
            }));
            clearTimeout(timer);
            if (res.ok) return await res.text();
            if (res.status === 403 || res.status === 429 || res.status >= 500) {
                lastErr = new Error(`HTTP ${res.status}`);
                if (i < retries - 1) await sleep(1000 * (i + 1));
                continue;
            }
            throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            clearTimeout(timer);
            lastErr = err.name === 'AbortError' ? new Error('Timeout 15s') : err;
            if (i < retries - 1) await sleep(1000 * (i + 1));
        }
    }
    throw new Error(`${lastErr.message} (after ${retries} retries)`);
}

async function downloadToBuffer(url, referer, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const headers = { 'User-Agent': USER_AGENT };
            if (referer) headers['Referer'] = referer;
            const res = await fetch(url, withProxy({ headers, signal: ctrl.signal }));
            clearTimeout(timer);
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            if (res.status === 403 || res.status === 429 || res.status >= 500) {
                lastErr = new Error(`HTTP ${res.status}`);
                if (i < retries - 1) await sleep(1000 * (i + 1));
                continue;
            }
            throw new Error(`HTTP ${res.status} for ${url}`);
        } catch (err) {
            clearTimeout(timer);
            lastErr = err.name === 'AbortError' ? new Error('Timeout 15s') : err;
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

// --------------- Main ---------------

async function main() {
    const { id, limit, force, source } = parseArgs();

    const sourceConfig = SOURCES[source];
    if (!sourceConfig) {
        console.error(`Unknown source: ${source}. Available: ${Object.keys(SOURCES).join(', ')}`);
        process.exit(1);
    }

    console.log(`=== Re-crawl Covers (${sourceConfig.label}) ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    if (force) console.log(`[FORCE] Re-download even if files exist`);
    console.log('');

    const mangaList = await getMangaList({ id, limit, force }, sourceConfig);
    console.log(`Found ${mangaList.length} manga to process\n`);

    if (mangaList.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    const results = { success: 0, skipped: 0, failed: 0 };
    const total = mangaList.length;

    async function processOne(manga, idx) {
        const prefix = `[${idx + 1}/${total}] id=${manga.id}`;

        const sourceUrl = sourceConfig.extractUrl(manga.from_manga18fx);
        if (!sourceUrl) {
            console.log(`${prefix} — no ${sourceConfig.label} URL, skipping`);
            results.skipped++;
            return;
        }

        console.log(`${prefix} ${sourceUrl}`);

        try {
            const coverUrl = await sourceConfig.fetchCoverUrl(sourceUrl);
            if (!coverUrl) {
                console.log(`  [x] No cover URL found on detail page`);
                results.failed++;
                return;
            }

            // imgur .jpg often returns webp — use .jpeg to get real JPEG
            let finalCoverUrl = coverUrl;
            if (finalCoverUrl.includes('i.imgur.com') && finalCoverUrl.endsWith('.jpg')) {
                finalCoverUrl = finalCoverUrl.replace(/\.jpg$/, '.jpeg');
            }
            console.log(`  [>] Cover: ${finalCoverUrl}`);
            const referer = new URL(sourceUrl).origin;
            const buffer = await downloadToBuffer(finalCoverUrl, referer);
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
