#!/usr/bin/env node

/**
 * Download & resize manga cover images by crawling source pages.
 *
 * Usage: node scripts/download-covers.js [--force]
 *
 * Flow:
 *   1. Read `from_manga18fx` field (comma-separated source URLs) from each manga
 *   2. Fetch the first URL for each manga
 *   3. Parse HTML to find cover image: div.info-cover img[src]
 *   4. Download image → sharp resize → save {slug}.jpg (600px) + {slug}-thumb.jpg (300px)
 *
 * Flags:
 *   --force  Re-download even if cover already exists
 *
 * Env vars (from ../.env):
 *   COVER_SAVE_DIR - local directory to save covers
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../config/database');
const { fetchPage } = require('../crawler/parsers/base');
const { downloadAndProcessCover, coverExists } = require('../crawler/cover-processor');

const CONCURRENCY = 3;
const MAX_RETRIES = 2;
const FORCE = process.argv.includes('--force');

function extractCoverUrl(html) {
    const match = html.match(/info-cover[\s\S]*?<img[^>]*src=["']([^"']+)["']/i);
    return match ? match[1] : null;
}

async function processManga(manga, idx, total) {
    const maxSlugLen = 245;
    const slug = manga.slug.length > maxSlugLen ? manga.slug.substring(0, maxSlugLen) : manga.slug;

    // Skip if both versions already exist (unless --force)
    if (!FORCE && coverExists(slug)) {
        return 'skipped';
    }

    // Get all source URLs from from_manga18fx
    const sourceUrls = manga.from_manga18fx.split(',').map(s => s.trim()).filter(Boolean);
    if (!sourceUrls.length) {
        console.error(`[${idx}/${total}] NO_URL: ${manga.slug}`);
        return 'failed';
    }

    // Try each source URL until one works
    for (const sourceUrl of sourceUrls) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const html = await fetchPage(sourceUrl);
                const coverUrl = extractCoverUrl(html);
                if (!coverUrl) break; // try next source URL

                await downloadAndProcessCover(coverUrl, slug);
                console.log(`[${idx}/${total}] OK: ${manga.slug}`);
                return 'success';
            } catch (err) {
                if (attempt === MAX_RETRIES) break; // try next source URL
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    console.error(`[${idx}/${total}] FAIL: ${manga.slug} — all source URLs failed`);
    return 'failed';
}

async function processChunk(items, startIndex, total) {
    const results = { success: 0, failed: 0, skipped: 0 };

    await Promise.all(items.map(async (manga, i) => {
        const idx = startIndex + i + 1;
        const result = await processManga(manga, idx, total);
        results[result]++;
    }));

    return results;
}

async function main() {
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log(`Force: ${FORCE}`);
    console.log('---');

    // Get all manga with source URLs
    const [rows] = await db.query(
        "SELECT slug, from_manga18fx FROM manga WHERE from_manga18fx IS NOT NULL AND from_manga18fx != '' ORDER BY id ASC"
    );
    const total = rows.length;
    console.log(`Found ${total} manga with source URLs.\n`);

    const stats = { success: 0, failed: 0, skipped: 0 };

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const result = await processChunk(chunk, i, total);
        stats.success += result.success;
        stats.failed += result.failed;
        stats.skipped += result.skipped;
    }

    console.log('\n===== DONE =====');
    console.log(`Total:    ${total}`);
    console.log(`Success:  ${stats.success}`);
    console.log(`Failed:   ${stats.failed}`);
    console.log(`Skipped:  ${stats.skipped} (already existed)`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
