#!/usr/bin/env node
/**
 * Fetch English names for xtoon365 manga
 *
 * Priority:
 *   1. Search mangaupdates.com → match Korean name → lấy English title (chính xác nhất)
 *   2. Fallback: Google Translate Korean → English (nếu mangaupdates không có)
 *
 * Usage:
 *   node crawler/run-fetch-en-names.js              # All xtoon365 without English name
 *   node crawler/run-fetch-en-names.js --limit 50  # Limit to 50 manga
 *   node crawler/run-fetch-en-names.js --id 123    # Specific manga by DB id
 *   node crawler/run-fetch-en-names.js --dry-run   # Preview only, no DB writes
 *   node crawler/run-fetch-en-names.js --force     # Re-fetch even if otherNames exists
 *   node crawler/run-fetch-en-names.js --no-translate  # Skip Google Translate fallback
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cheerio = require('cheerio');
const translate = require('google-translate-api-x');
const db = require('../config/database');
const { withProxy } = require('./proxy');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SEARCH_BASE = 'https://www.mangaupdates.com/site/search/result?search=';
const CONCURRENCY = 20; // 20 proxies → 20 luồng song song

// --------------- Args ---------------

function parseArgs() {
    const args = process.argv.slice(2);
    const idIdx = args.indexOf('--id');
    const limitIdx = args.indexOf('--limit');
    return {
        id: idIdx !== -1 ? parseInt(args[idIdx + 1], 10) : null,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null,
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        noTranslate: args.includes('--no-translate'),
    };
}

// --------------- DB ---------------

async function getMangaList({ id, limit, force }) {
    if (id) {
        const [rows] = await db.query(
            'SELECT id, name, slug, otherNames, summary, from_manga18fx FROM manga WHERE id = ?',
            [id]
        );
        return rows;
    }

    // Only xtoon365 manga (from_manga18fx contains xtoon domain)
    let query = `SELECT id, name, slug, otherNames, summary, from_manga18fx FROM manga
                 WHERE (from_manga18fx LIKE '%xtoon365.com%' OR from_manga18fx LIKE '%xtoon33.com%')`;

    if (!force) {
        query += ` AND (from_manga18fx NOT LIKE '%mangaupdates.com%')`;
    }

    query += ` ORDER BY id ASC`;

    if (limit) {
        query += ` LIMIT ${parseInt(limit, 10)}`;
    }

    const [rows] = await db.query(query);
    return rows;
}

// --------------- Fetch ---------------

async function fetchHtml(url, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, withProxy({
                headers: { 'User-Agent': USER_AGENT },
            }));
            if (res.ok) return res.text();
            // Retry on 403/429/5xx (proxy issue or rate limit)
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
    throw new Error(`${lastErr.message} (after ${retries} retries) for ${url}`);
}

// --------------- Google Translate fallback ---------------

// Rate limit: Google Translate không dùng proxy, chạy tuần tự với delay
const TRANSLATE_DELAY = 1500;
let lastTranslateTime = 0;

async function translateKoEn(text) {
    // Throttle: chờ đủ delay kể từ lần dịch trước
    const now = Date.now();
    const wait = TRANSLATE_DELAY - (now - lastTranslateTime);
    if (wait > 0) await sleep(wait);
    lastTranslateTime = Date.now();

    const res = await translate(text, { from: 'ko', to: 'en' });
    return res.text || null;
}

// --------------- Slug ---------------

/**
 * Generate slug từ tên tiếng Anh
 * "Orchard of Temptation" → "orchard-of-temptation"
 */
function generateEnglishSlug(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// --------------- Mangaupdates ---------------

/**
 * Normalize a name for comparison: lowercase, trim, strip punctuation/spaces
 * "코인으로 떡상!" === "코인으로 떡상" → true
 */
function normalize(str) {
    return (str || '').trim().toLowerCase().replace(/[\s\p{P}]/gu, '');
}

/**
 * Search mangaupdates and return the detail URL if a matching Korean name is found
 * Matching: span.fst-italic text == manga's Korean name
 */
async function searchMangaUpdates(koreanName) {
    const url = SEARCH_BASE + encodeURIComponent(koreanName);
    let html;
    try {
        html = await fetchHtml(url);
    } catch (err) {
        throw new Error(`Search failed: ${err.message}`);
    }

    const $ = cheerio.load(html);
    const norm = normalize(koreanName);

    let detailUrl = null;

    // Each result row: div.col-12.row.g-0 that has series-list-module in class
    $('div.col-12.row.g-0').each((_, el) => {
        if (detailUrl) return; // already found

        const $row = $(el);
        // Title link inside the row
        const $link = $row.find('a[href*="/series/"]').first();
        if (!$link.length) return;

        const titleText = normalize($link.find('span.fst-italic').text());
        if (!titleText) return;

        // Match: exact or trimmed match
        if (titleText === norm) {
            detailUrl = $link.attr('href');
            // Ensure full URL
            if (detailUrl && !detailUrl.startsWith('http')) {
                detailUrl = `https://www.mangaupdates.com${detailUrl}`;
            }
        }
    });

    return detailUrl;
}

/**
 * Fetch detail page → extract:
 *   - englishName  : span.releasestitle.tabletitle
 *   - descHtml     : innerHTML của div[data-cy="info-box-description"] (đầy đủ)
 *   - otherNames   : div[data-cy="info-box-associated"] div (tất cả tên liên quan)
 */
async function getMangaDetails(detailUrl) {
    const html = await fetchHtml(detailUrl);
    const $ = cheerio.load(html);

    const englishName = $('span.releasestitle.tabletitle').first().text().trim() || null;

    // Lấy đủ HTML bên trong description div
    const descHtml = $('div[data-cy="info-box-description"]').first().html() || null;

    const otherNames = [];
    $('div[data-cy="info-box-associated"] div').each((_, el) => {
        const n = $(el).text().trim();
        if (n) otherNames.push(n);
    });

    return { englishName, descHtml, otherNames };
}

// --------------- Main ---------------

async function main() {
    const { id, limit, dryRun, force, noTranslate } = parseArgs();

    console.log(`=== Fetch English Names (MangaUpdates + Google Translate) ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    if (dryRun)       console.log(`[DRY RUN] No DB writes`);
    if (force)        console.log(`[FORCE] Re-fetch even if otherNames exists`);
    if (noTranslate)  console.log(`[NO-TRANSLATE] Skip Google Translate fallback`);
    console.log('');

    const mangaList = await getMangaList({ id, limit, force });
    console.log(`Found ${mangaList.length} manga to process\n`);

    if (mangaList.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    const results = { mangaupdates: 0, translated: 0, notFound: 0, failed: 0, skipped: 0 };
    const total = mangaList.length;

    async function processOne(manga, idx) {
        const prefix = `[${idx + 1}/${total}] id=${manga.id}`;
        console.log(`${prefix} "${manga.name}"`);

        if (!force && manga.otherNames) {
            console.log(`  [=] Already has otherNames: "${manga.otherNames}", skipping`);
            results.skipped++;
            return;
        }

        try {
            // Step 1: Search mangaupdates
            const detailUrl = await searchMangaUpdates(manga.name);

            let englishName = null;
            let newOtherNames = null;
            let newSummary = null;
            let source = '';

            if (detailUrl) {
                // Step 2a: Get details from MangaUpdates detail page
                console.log(`  [>] Match: ${detailUrl}`);
                const details = await getMangaDetails(detailUrl);
                englishName = details.englishName;

                // otherNames = tất cả associated names + tên Hàn cũ (manga.name)
                const koName = manga.name;
                const assocNames = details.otherNames.filter(
                    n => normalize(n) !== normalize(koName)
                );
                const otherParts = [...assocNames];
                if (koName) otherParts.push(koName);
                newOtherNames = otherParts.join(', ') || null;

                // summary = [Korean summary]\n------\n[English desc HTML]
                if (details.descHtml) {
                    const koSummary = (manga.summary || '').trim();
                    newSummary = koSummary
                        ? `${koSummary}\n------\n${details.descHtml}`
                        : details.descHtml;
                }

                if (englishName) source = 'mangaupdates';
            }

            if (!englishName && !noTranslate) {
                // Step 2b: Fallback — Google Translate Korean → English
                console.log(`  [~] Not on MangaUpdates, trying Google Translate...`);
                try {
                    englishName = await translateKoEn(manga.name);
                    if (englishName) {
                        source = 'translate';
                        // otherNames = tên Hàn cũ
                        newOtherNames = manga.name || null;
                    }
                } catch (tErr) {
                    console.error(`  [!] Translate error: ${tErr.message}`);
                }
            }

            if (!englishName) {
                console.log(`  [x] No English name found`);
                results.notFound++;
                return;
            }

            // Step 3: Slug mới từ tên tiếng Anh
            const newSlug = generateEnglishSlug(englishName);

            console.log(`  [+] name    [${source}]: "${englishName}"`);
            console.log(`  [+] slug:  "${manga.slug}" → "${newSlug}"`);
            if (newOtherNames) console.log(`  [+] otherNames: "${newOtherNames.slice(0, 80)}"`);
            if (newSummary)    console.log(`  [+] summary: ${newSummary.slice(0, 60)}...`);

            // Step 4: Update DB
            if (!dryRun) {
                const updates = {
                    name: englishName,
                    slug: newSlug,
                    otherNames: newOtherNames,
                };
                if (newSummary) updates.summary = newSummary;

                // Append mangaupdates URL vào from_manga18fx nếu chưa có
                if (detailUrl) {
                    const existing = manga.from_manga18fx || '';
                    if (!existing.includes(detailUrl)) {
                        updates.from_manga18fx = existing ? `${existing},${detailUrl}` : detailUrl;
                    }
                }

                const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
                await db.query(
                    `UPDATE manga SET ${sets} WHERE id = ?`,
                    [...Object.values(updates), manga.id]
                );
            } else if (detailUrl) {
                console.log(`  [+] from_manga18fx: +${detailUrl}`);
            }

            if (source === 'mangaupdates') results.mangaupdates++;
            else results.translated++;
        } catch (err) {
            console.error(`  [!] Error id=${manga.id}: ${err.message}`);
            results.failed++;
        }
    }

    // Process in batches of CONCURRENCY (18 parallel — 1 per proxy)
    for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = mangaList.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((manga, j) => processOne(manga, i + j)));
    }

    console.log(`\n=== Summary ===`);
    console.log(`MangaUpdates:   ${results.mangaupdates}`);
    console.log(`Google Translate: ${results.translated}`);
    console.log(`Not found:      ${results.notFound}`);
    console.log(`Skipped:        ${results.skipped}`);
    console.log(`Failed:         ${results.failed}`);

    process.exit(0);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
    console.error('[!] Fatal:', err);
    process.exit(1);
});
