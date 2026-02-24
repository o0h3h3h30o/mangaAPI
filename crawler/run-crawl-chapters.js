#!/usr/bin/env node
/**
 * Crawl chapter pages for unpublished chapters (is_show = 0)
 *
 * Usage:
 *   node crawler/run-crawl-chapters.js                  # Crawl up to 50 chapters
 *   node crawler/run-crawl-chapters.js --limit 100      # Crawl up to 100 chapters
 *   node crawler/run-crawl-chapters.js --manga-id 42    # Only crawl chapters for manga id=42
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { crawlChapterPages } = require('./crawler');

async function flushApiCache() {
    const port = process.env.PORT || 3000;
    try {
        const res = await fetch(`http://localhost:${port}/api/internal/cache-flush`, { method: 'POST' });
        if (res.ok) console.log('[*] API cache flushed');
    } catch {
        console.log('[!] Could not flush API cache (server not running?)');
    }
}

async function main() {
    const args = process.argv.slice(2);

    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;

    const mangaIdx = args.indexOf('--manga-id');
    const mangaId = mangaIdx !== -1 ? parseInt(args[mangaIdx + 1], 10) : null;

    console.log(`=== Crawl Chapter Pages ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Limit: ${limit}`);
    if (mangaId) console.log(`Manga ID: ${mangaId}`);
    console.log('');

    try {
        const results = await crawlChapterPages({ limit, mangaId });
        if (results.success > 0) {
            await flushApiCache();
        }
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }

    process.exit(0);
}

main();
