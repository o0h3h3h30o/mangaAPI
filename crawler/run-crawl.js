#!/usr/bin/env node
/**
 * CLI script to run the crawler
 *
 * Usage:
 *   node crawler/run-crawl.js                        # Crawl all sources
 *   node crawler/run-crawl.js --source jestful        # Crawl one source
 *   node crawler/run-crawl.js --source jestful --dry-run  # Parse only, no DB writes
 *   node crawler/run-crawl.js --list                  # List available parsers
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { crawlSite, crawlAll } = require('./crawler');
const { getAllParsers, getParserByName } = require('./parsers');
const base = require('./parsers/base');

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isList = args.includes('--list');
    const sourceIdx = args.indexOf('--source');
    const sourceName = sourceIdx !== -1 ? args[sourceIdx + 1] : null;

    // --list: show available parsers
    if (isList) {
        const parsers = getAllParsers();
        console.log(`Available parsers (${parsers.length}):\n`);
        for (const p of parsers) {
            console.log(`  ${p.name}\t${p.baseUrl}`);
        }
        process.exit(0);
    }

    // --dry-run: parse homepage only, no DB
    if (isDryRun) {
        const parsers = sourceName ? [getParserByName(sourceName)] : getAllParsers();

        for (const siteParser of parsers) {
            console.log(`=== DRY RUN: ${siteParser.name} (${siteParser.baseUrl}) ===\n`);
            const html = await base.fetchPage(siteParser.baseUrl);
            const items = siteParser.parseHomepage(html);

            console.log(`Found ${items.length} manga:\n`);
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

    // Normal crawl
    try {
        if (sourceName) {
            await crawlSite(sourceName);
        } else {
            await crawlAll();
        }
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }

    process.exit(0);
}

main();
