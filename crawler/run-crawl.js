#!/usr/bin/env node
/**
 * CLI script to run the crawler
 *
 * Usage:
 *   node crawler/run-crawl.js                              # Crawl all sources (default 3 pages)
 *   node crawler/run-crawl.js --pages 10                   # Crawl 10 pages
 *   node crawler/run-crawl.js --source jestful             # Crawl one source
 *   node crawler/run-crawl.js --source jestful --pages 5   # Crawl one source, 5 pages
 *   node crawler/run-crawl.js --dry-run                    # Parse only, no DB writes
 *   node crawler/run-crawl.js --dry-run --pages 10         # Dry-run 10 pages
 *   node crawler/run-crawl.js --source xtoon365 --url https://t1.xtoon365.com/category/theme/302/finish/1  # Custom URL
 *   node crawler/run-crawl.js --source xtoon365 --pages 5 --start-page 3  # Pages 3-7
 *   node crawler/run-crawl.js --list                       # List available parsers
 *   node crawler/run-crawl.js --source raw18 --limit 1     # Process only 1 manga then exit (debug)
 *   node crawler/run-crawl.js --manga-url <url>            # Single manga — auto-detect parser
 *   node crawler/run-crawl.js --manga-url https://manhwawebbackend-production.up.railway.app/manhwa/see/secret_class_1679631363177
 *   node crawler/run-crawl.js --manga-url https://raw18.men/manga/<slug>
 *   node crawler/run-crawl.js --manga-url https://jestful.net/hwms-<slug>.html
 *   node crawler/run-crawl.js --manga-url https://t1.xtoon365.com/webtoon/<slug>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { crawlSite, crawlAll, processManga } = require('./crawler');
const { getAllParsers, getParserByName } = require('./parsers');
const base = require('./parsers/base');

async function flushApiCache() {
    const port = process.env.PORT || 3000;
    try {
        const res = await fetch(`http://localhost:${port}/api/internal/cache-flush`, { method: 'POST' });
        if (res.ok) console.log('[*] API cache flushed');
    } catch {
        console.log('[!] Could not flush API cache (server not running?)');
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const sourceIdx = args.indexOf('--source');
    const pagesIdx = args.indexOf('--pages');
    const urlIdx = args.indexOf('--url');
    const startPageIdx = args.indexOf('--start-page');
    const mangaUrlIdx = args.indexOf('--manga-url');
    const limitIdx = args.indexOf('--limit');
    return {
        isDryRun: args.includes('--dry-run'),
        isList: args.includes('--list'),
        sourceName: sourceIdx !== -1 ? args[sourceIdx + 1] : null,
        pages: pagesIdx !== -1 ? parseInt(args[pagesIdx + 1], 10) : undefined,
        url: urlIdx !== -1 ? args[urlIdx + 1] : undefined,
        startPage: startPageIdx !== -1 ? parseInt(args[startPageIdx + 1], 10) : undefined,
        mangaUrl: mangaUrlIdx !== -1 ? args[mangaUrlIdx + 1] : undefined,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined,
    };
}

async function main() {
    const { isDryRun, isList, sourceName, pages, url, startPage, mangaUrl, limit } = parseArgs();

    // --list: show available parsers
    if (isList) {
        const parsers = getAllParsers();
        console.log(`Available parsers (${parsers.length}):\n`);
        for (const p of parsers) {
            console.log(`  ${p.name}\t${p.baseUrl}`);
        }
        process.exit(0);
    }

    if (pages) console.log(`Pages: ${pages}\n`);

    // --dry-run: parse homepage only, no DB
    if (isDryRun) {
        const parsers = sourceName ? [getParserByName(sourceName)] : getAllParsers();

        for (const siteParser of parsers) {
            console.log(`=== DRY RUN: ${siteParser.name} (${siteParser.baseUrl}) ===\n`);

            const urls = siteParser.getHomepageUrls
                ? siteParser.getHomepageUrls(pages, url, startPage)
                : [siteParser.baseUrl];

            const items = [];
            for (let i = 0; i < urls.length; i++) {
                console.log(`[Page ${i + 1}/${urls.length}] ${urls[i]}`);
                const html = await base.fetchPage(urls[i]);
                const pageItems = siteParser.parseHomepage(html);
                console.log(`  Found ${pageItems.length} manga\n`);
                items.push(...pageItems);
            }

            console.log(`Total: ${items.length} manga:\n`);
            for (const item of items) {
                console.log(`  ${item.name}`);
                console.log(`    URL: ${item.url}`);
                console.log(`    Cover: ${item.coverUrl}`);
                console.log(`    Chapters: ${item.chapters.map(c => c.number).join(', ')}`);
                console.log('');
            }
        }
        process.exit(0);
    }

    // Single manga URL
    if (mangaUrl) {
        console.log(`=== Single manga: ${mangaUrl} ===\n`);
        try {
            const result = await processManga({
                name: 'single',
                url: mangaUrl,
                coverUrl: '',
                chapters: [],
                latestChapterNum: 0,
            });
            console.log(`\nResult: ${result.status}${result.mangaId ? ', id=' + result.mangaId : ''}`);
        } catch (err) {
            console.error('Error:', err.message);
        }
        await flushApiCache();
        process.exit(0);
    }

    // Normal crawl
    try {
        if (sourceName) {
            await crawlSite(sourceName, { pages, url, startPage, limit });
        } else {
            await crawlAll({ pages, limit });
        }
        await flushApiCache();
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }

    process.exit(0);
}

main();
