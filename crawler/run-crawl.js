#!/usr/bin/env node
/**
 * CLI script to run the homepage crawler
 *
 * Usage:
 *   node crawler/run-crawl.js              # Crawl homepage once
 *   node crawler/run-crawl.js --dry-run    # Parse only, no DB writes
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { crawlHomepage, fetchPage } = require('./crawler');
const parser = require('./parsers/jestful');

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');

    if (isDryRun) {
        console.log('=== DRY RUN: Parse only, no DB writes ===\n');
        const html = await fetchPage(parser.BASE_URL);
        const items = parser.parseHomepage(html);

        console.log(`Found ${items.length} manga:\n`);
        for (const item of items) {
            console.log(`  ${item.name}`);
            console.log(`    URL: ${item.url}`);
            console.log(`    Cover: ${item.coverUrl}`);
            console.log(`    Chapters: ${item.chapters.map(c => c.number).join(', ')}`);
            console.log('');
        }
        process.exit(0);
    }

    try {
        await crawlHomepage();
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }

    process.exit(0);
}

main();
