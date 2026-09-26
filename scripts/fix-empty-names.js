#!/usr/bin/env node
/**
 * Backfill manga.name for rows where name is NULL or empty.
 *
 * For each affected manga:
 *   1. Read source URLs from from_manga18fx (comma-separated)
 *   2. Fetch the detail page through the matching parser
 *   3. Take info.name from extractMangaInfo() — the parsers already handle
 *      the jestful " - RAW" / " - JF" suffixes and <title> fallback
 *   4. UPDATE manga SET name = <parsed name>
 *
 * Usage:
 *   node scripts/fix-empty-names.js --dry-run          # preview only
 *   node scripts/fix-empty-names.js                    # apply
 *   node scripts/fix-empty-names.js --limit 100
 *   node scripts/fix-empty-names.js --id 12345
 *   node scripts/fix-empty-names.js --concurrency 5
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../config/database');
const { getParser } = require('../crawler/parsers');
const base = require('../crawler/parsers/base');

function parseArgs() {
    const a = process.argv.slice(2);
    const idx = (f) => a.indexOf(f);
    const val = (f) => idx(f) !== -1 ? a[idx(f) + 1] : null;
    return {
        dryRun: a.includes('--dry-run'),
        limit: idx('--limit') !== -1 ? parseInt(val('--limit'), 10) : null,
        id: idx('--id') !== -1 ? parseInt(val('--id'), 10) : null,
        concurrency: idx('--concurrency') !== -1 ? parseInt(val('--concurrency'), 10) : 5,
    };
}

function extractUrls(fromManga18fx) {
    return (fromManga18fx || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => /^https?:\/\//i.test(s));
}

// Defensive blacklist — refuse to write these obviously-not-a-name strings even
// when a parser hands them back. Covers soft-404s and other error-page titles.
const BAD_NAME = /^(sorry.*(page\s+)?not\s+found|page\s+not\s+found|not\s+found|error\s*404|access\s+denied|404\s*not\s*found|forbidden)$/i;

function isPlausibleName(name) {
    if (!name) return false;
    const trimmed = name.trim();
    if (trimmed.length < 2) return false;
    if (BAD_NAME.test(trimmed)) return false;
    return true;
}

async function resolveName(manga) {
    const urls = extractUrls(manga.from_manga18fx);
    if (urls.length === 0) return { name: null, error: 'no-source-url' };

    for (const url of urls) {
        let parser;
        try { parser = getParser(url); }
        catch { continue; }                            // no parser for this URL, try next
        if (!parser.extractMangaInfo) continue;

        try {
            const html = await base.fetchPage(url);
            const info = parser.extractMangaInfo(html);
            if (info && isPlausibleName(info.name)) {
                return { name: info.name.trim(), source: parser.name, url };
            }
        } catch (e) {
            // try next url on network/parse errors
        }
    }
    return { name: null, error: 'no-name-parsed' };
}

function runPool(items, concurrency, handler) {
    let running = 0, idx = 0;
    let ok = 0, fail = 0;
    return new Promise((resolve) => {
        function next() {
            while (running < concurrency && idx < items.length) {
                const item = items[idx++];
                running++;
                handler(item)
                    .then((r) => { if (r) ok++; else fail++; })
                    .catch(() => { fail++; })
                    .finally(() => {
                        running--;
                        if (idx >= items.length && running === 0) resolve({ ok, fail });
                        else next();
                    });
            }
            if (items.length === 0) resolve({ ok: 0, fail: 0 });
        }
        next();
    });
}

async function main() {
    const opts = parseArgs();
    console.log('=== Fix Empty Manga Names ===');
    console.log(`Mode: ${opts.dryRun ? 'DRY-RUN (no UPDATE)' : 'APPLY'} | Concurrency: ${opts.concurrency}`);
    if (opts.limit) console.log(`Limit: ${opts.limit}`);
    if (opts.id) console.log(`Manga ID: ${opts.id}`);
    console.log('');

    let sql = `SELECT id, name, slug, from_manga18fx
               FROM manga
               WHERE (name IS NULL OR name = '')`;
    const params = [];
    if (opts.id) { sql += ' AND id = ?'; params.push(opts.id); }
    sql += ' ORDER BY id';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    const [rows] = await db.query(sql, params);
    console.log(`Manga cần fix: ${rows.length.toLocaleString()}\n`);
    if (rows.length === 0) { process.exit(0); }

    const results = { fixed: 0, noUrl: 0, noName: 0, noParser: 0 };

    await runPool(rows, opts.concurrency, async (m) => {
        const r = await resolveName(m);
        if (r.name) {
            console.log(`  [+] id=${m.id.toString().padEnd(6)} → "${r.name}"  (${r.source})`);
            if (!opts.dryRun) {
                await db.query('UPDATE manga SET name = ? WHERE id = ?', [r.name, m.id]);
            }
            results.fixed++;
            return true;
        }
        if (r.error === 'no-source-url') results.noUrl++;
        else results.noName++;
        console.log(`  [!] id=${m.id.toString().padEnd(6)} → ${r.error}  (from_manga18fx="${(m.from_manga18fx || '').slice(0, 80)}")`);
        return false;
    });

    console.log('\n===== SUMMARY =====');
    console.log(`Fixed:            ${results.fixed}`);
    console.log(`No source URL:    ${results.noUrl}`);
    console.log(`No parseable name: ${results.noName}`);
    if (opts.dryRun) console.log('\n(dry-run — nothing was written to DB)');
    process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
