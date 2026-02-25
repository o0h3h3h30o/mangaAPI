#!/usr/bin/env node
/**
 * Crawl chapter pages for unpublished chapters (is_show = 0)
 *
 * Usage:
 *   node crawler/run-crawl-chapters.js                  # Crawl up to 50 chapters
 *   node crawler/run-crawl-chapters.js --limit 100      # Crawl up to 100 chapters
 *   node crawler/run-crawl-chapters.js --manga-id 42    # Only crawl chapters for manga id=42
 *   node crawler/run-crawl-chapters.js --order newest   # Order by created_at DESC
 *   node crawler/run-crawl-chapters.js --output /path/to/chapter  # Download images locally
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

    const orderIdx = args.indexOf('--order');
    const orderArg = orderIdx !== -1 ? args[orderIdx + 1] : null;
    const orderBy = orderArg === 'newest' ? 'c.created_at DESC' : undefined;

    const outputIdx = args.indexOf('--output');
    const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : null;

    console.log(`=== Crawl Chapter Pages ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Limit: ${limit}`);
    if (mangaId) console.log(`Manga ID: ${mangaId}`);
    if (orderArg) console.log(`Order: ${orderArg}`);
    if (outputDir) console.log(`Output: ${outputDir}`);
    console.log('');

    try {
        const results = await crawlChapterPages({ limit, mangaId, orderBy, outputDir });
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
