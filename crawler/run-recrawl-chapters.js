#!/usr/bin/env node
/**
 * Re-crawl tất cả chapters cho manga đã có trong DB (sau khi truncate chapter/page)
 *
 * Usage:
 *   node crawler/run-recrawl-chapters.js --source xtoon365
 *   node crawler/run-recrawl-chapters.js --source raw18
 *   node crawler/run-recrawl-chapters.js --source manhwaweb
 *   node crawler/run-recrawl-chapters.js --source jestful
 *   node crawler/run-recrawl-chapters.js --source xtoon365 --manga-id 42
 *   node crawler/run-recrawl-chapters.js --source xtoon365 --limit 10
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../config/database');
const base = require('./parsers/base');
const { getParserByName } = require('./parsers');
const { insertChapters } = require('./crawler');

function parseArgs() {
    const args = process.argv.slice(2);
    const sourceIdx = args.indexOf('--source');
    const mangaIdx = args.indexOf('--manga-id');
    const limitIdx = args.indexOf('--limit');
    return {
        sourceName: sourceIdx !== -1 ? args[sourceIdx + 1] : null,
        mangaId: mangaIdx !== -1 ? parseInt(args[mangaIdx + 1], 10) : null,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null,
    };
}

async function main() {
    const { sourceName, mangaId, limit } = parseArgs();

    if (!sourceName) {
        console.error('Usage: node crawler/run-recrawl-chapters.js --source <parser-name>');
        process.exit(1);
    }

    const siteParser = getParserByName(sourceName);

    // Domain patterns for DB filter. Parsers may declare `urlPatterns` (e.g. raw18
    // with multiple legacy domains, manhwaweb with a separate API host) — fall back
    // to baseUrl if not provided.
    const patterns = (siteParser.urlPatterns && siteParser.urlPatterns.length > 0)
        ? siteParser.urlPatterns
        : [siteParser.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')];

    console.log(`=== Re-crawl chapters: ${siteParser.name} ===`);
    console.log(`Time: ${new Date().toISOString()}\n`);
    console.log(`Matching DB against: ${patterns.join(', ')}\n`);

    // Query manga có source URL thuộc parser này (OR LIKE cho từng pattern)
    const whereLike = patterns.map(() => 'from_manga18fx LIKE ?').join(' OR ');
    let query = `SELECT id, name, slug, from_manga18fx FROM manga WHERE (${whereLike})`;
    const params = patterns.map(p => `%${p}%`);

    if (mangaId) {
        query += ' AND id = ?';
        params.push(mangaId);
    }

    query += ' ORDER BY id ASC';

    if (limit) {
        query += ' LIMIT ?';
        params.push(limit);
    }

    const [mangas] = await db.query(query, params);
    console.log(`Found ${mangas.length} manga from ${siteParser.name}\n`);

    if (mangas.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    const results = { success: 0, failed: 0, totalChapters: 0 };

    for (let i = 0; i < mangas.length; i++) {
        const manga = mangas[i];

        // Lấy source URL đúng parser từ from_manga18fx (có thể chứa nhiều URL)
        const sourceUrl = (manga.from_manga18fx || '')
            .split(',')
            .map(u => u.trim())
            .find(u => siteParser.match(u));

        if (!sourceUrl) {
            console.log(`[${i + 1}/${mangas.length}] ${manga.name} (id=${manga.id}) — no matching URL, skip`);
            results.failed++;
            continue;
        }

        try {
            console.log(`[${i + 1}/${mangas.length}] ${manga.name} (id=${manga.id})`);
            console.log(`  [>] ${sourceUrl}`);

            const allChapters = await siteParser.getFullChapterList(sourceUrl);
            console.log(`  [>] Found ${allChapters.length} chapters`);

            const inserted = await insertChapters(manga.id, allChapters);
            results.totalChapters += inserted;
            results.success++;
        } catch (err) {
            console.error(`  [!] Error: ${err.message}`);
            results.failed++;
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Success: ${results.success}`);
    console.log(`Failed:  ${results.failed}`);
    console.log(`Total chapters inserted: ${results.totalChapters}`);

    process.exit(0);
}

main();
