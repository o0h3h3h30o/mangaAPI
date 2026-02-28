#!/usr/bin/env node
/**
 * Migrate page images from external sources to Hetzner S3
 *
 * Flow: Source (jfimv2.xyz) --[proxy]--> RAM buffer ---> Hetzner S3
 *       Then UPDATE page SET image_local = '{filename}'
 *
 * Usage:
 *   node scripts/migrate-pages-to-s3.js                    # Only unmigrated pages
 *   node scripts/migrate-pages-to-s3.js --force            # Re-upload ALL pages
 *   node scripts/migrate-pages-to-s3.js --verify           # Check S3, only upload missing
 *   node scripts/migrate-pages-to-s3.js --limit 10000      # First 10K pages
 *   node scripts/migrate-pages-to-s3.js --chapter-id 123   # One chapter
 *   node scripts/migrate-pages-to-s3.js --concurrency 200  # Custom concurrency
 *   node scripts/migrate-pages-to-s3.js --direction desc   # Newest first (run 2 processes: asc + desc)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../config/database');
const { uploadToS3, existsOnS3 } = require('../lib/s3');
const { withProxy } = require('../crawler/proxy');

const BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 100;
const VERIFY_CONCURRENCY = 500;
const MAX_RETRIES = 2;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function parseArgs() {
    const args = process.argv.slice(2);
    const limitIdx = args.indexOf('--limit');
    const chapterIdx = args.indexOf('--chapter-id');
    const concIdx = args.indexOf('--concurrency');
    const dirIdx = args.indexOf('--direction');
    return {
        force: args.includes('--force'),
        verify: args.includes('--verify'),
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null,
        chapterId: chapterIdx !== -1 ? parseInt(args[chapterIdx + 1], 10) : null,
        concurrency: concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : DEFAULT_CONCURRENCY,
        direction: dirIdx !== -1 && args[dirIdx + 1] === 'desc' ? 'desc' : 'asc',
    };
}

async function downloadImage(url, referer) {
    const headers = {
        'User-Agent': USER_AGENT,
        'Referer': referer || '',
    };

    // Try with proxy first
    const res = await fetch(url, withProxy({
        headers,
        signal: AbortSignal.timeout(30000),
    }));

    if (res.ok) return Buffer.from(await res.arrayBuffer());

    // Proxy might be blocked → retry direct (no proxy)
    if (res.status === 403 || res.status === 404) {
        const directRes = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(30000),
        });
        if (directRes.ok) return Buffer.from(await directRes.arrayBuffer());
        throw new Error(`HTTP ${directRes.status} (direct)`);
    }

    throw new Error(`HTTP ${res.status}`);
}

function getContentType(url) {
    const ext = url.split('.').pop().split('?')[0].toLowerCase();
    const types = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    return types[ext] || 'image/jpeg';
}

function getExtension(url) {
    const ext = url.split('.').pop().split('?')[0].toLowerCase();
    if (['png', 'webp', 'gif', 'jpg', 'jpeg'].includes(ext)) return '.' + ext;
    return '.jpg';
}

function getS3Key(page) {
    const filename = page.slug + getExtension(page.image);
    return { filename, s3Key: `chapter/${page.chapter_id}/${filename}` };
}

async function processPage(page) {
    const { filename, s3Key } = getS3Key(page);
    // Referer = source site origin (e.g. https://t1.xtoon365.com)
    const referer = page.source_origin || '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const buffer = await downloadImage(page.image, referer);
            await uploadToS3(s3Key, buffer, getContentType(page.image));
            await db.query('UPDATE page SET image_local = ? WHERE id = ?', [filename, page.id]);
            return true;
        } catch (err) {
            // 404 = image gone from CDN → mark as _404 so we skip it next time
            if (err.message.includes('404')) {
                await db.query("UPDATE page SET image_local = '_404' WHERE id = ?", [page.id]);
                return '_404';
            }
            if (attempt === MAX_RETRIES) throw err;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}

function runPool(items, concurrency, handler) {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const errors = [];
    let running = 0;
    let idx = 0;

    return new Promise((resolve) => {
        function next() {
            while (running < concurrency && idx < items.length) {
                const item = items[idx++];
                running++;
                handler(item)
                    .then((result) => {
                        if (result === 'skipped') skipped++;
                        else if (result === '_404') skipped++;
                        else success++;
                    })
                    .catch((err) => {
                        failed++;
                        errors.push({ id: item.id, image: item.image, error: err.message });
                    })
                    .finally(() => {
                        running--;
                        if (idx >= items.length && running === 0) resolve({ success, failed, skipped, errors });
                        else next();
                    });
            }
            if (items.length === 0) resolve({ success, failed, skipped, errors });
        }
        next();
    });
}

function buildWhereClause(force, chapterId) {
    const conditions = ['p.external = 1'];
    const params = [];
    if (!force) {
        conditions.push("(p.image_local IS NULL OR p.image_local = '')");
    }
    if (chapterId) {
        conditions.push('p.chapter_id = ?');
        params.push(chapterId);
    }
    return { where: conditions.join(' AND '), params };
}

// ==================== VERIFY MODE ====================
async function runVerifyMode({ limit, chapterId, concurrency }) {
    const verifyConcurrency = Math.max(concurrency, VERIFY_CONCURRENCY);

    // Scan ALL pages that have image_local set
    const conditions = ['external = 1', "image_local IS NOT NULL", "image_local != ''"];
    const params = [];
    if (chapterId) { conditions.push('chapter_id = ?'); params.push(chapterId); }

    const [[{ cnt: total }]] = await db.query(
        `SELECT COUNT(*) as cnt FROM page WHERE ${conditions.join(' AND ')}`, params
    );
    const totalToScan = limit ? Math.min(limit, total) : total;
    console.log(`Pages to verify on S3: ${totalToScan.toLocaleString()}`);
    console.log(`Verify concurrency: ${verifyConcurrency}\n`);

    let scanned = 0;
    let missing = 0;
    let uploaded = 0;
    let failedUpload = 0;
    let lastId = 0;
    const startTime = Date.now();

    while (scanned < totalToScan) {
        const batchLimit = Math.min(BATCH_SIZE, totalToScan - scanned);
        const batchParams = [...params];
        const sql = `SELECT id, slug, image, image_local, chapter_id FROM page WHERE ${conditions.join(' AND ')} AND id > ? ORDER BY id ASC LIMIT ?`;
        batchParams.push(lastId, batchLimit);

        const [pages] = await db.query(sql, batchParams);
        if (pages.length === 0) break;
        lastId = pages[pages.length - 1].id;

        // Phase 1: Check S3 existence (fast, high concurrency)
        const missingPages = [];
        await runPool(pages, verifyConcurrency, async (page) => {
            const { s3Key } = getS3Key(page);
            const exists = await existsOnS3(s3Key);
            if (!exists) missingPages.push(page);
            return exists ? 'skipped' : true;
        });

        missing += missingPages.length;
        scanned += pages.length;

        // Phase 2: Upload missing ones (slower, needs proxy)
        if (missingPages.length > 0) {
            const result = await runPool(missingPages, concurrency, processPage);
            uploaded += result.success;
            failedUpload += result.failed;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = scanned / elapsed;
        const eta = rate > 0 ? ((totalToScan - scanned) / rate / 60).toFixed(1) : '?';

        console.log(
            `[${scanned.toLocaleString()}/${totalToScan.toLocaleString()}] ` +
            `Missing: ${missingPages.length} | Uploaded: ${uploaded} | ` +
            `Speed: ${rate.toFixed(0)} check/s | ETA: ${eta}min`
        );
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('\n===== VERIFY DONE =====');
    console.log(`Scanned:  ${scanned.toLocaleString()}`);
    console.log(`Missing:  ${missing.toLocaleString()}`);
    console.log(`Uploaded: ${uploaded.toLocaleString()}`);
    console.log(`Failed:   ${failedUpload.toLocaleString()}`);
    console.log(`Time:     ${elapsed} min`);
}

// ==================== NORMAL/FORCE MODE ====================
async function runMigrateMode({ force, limit, chapterId, concurrency, direction }) {
    const isDesc = direction === 'desc';
    const { where, params: countParams } = buildWhereClause(force, chapterId);
    const [[{ cnt: totalRemaining }]] = await db.query(
        `SELECT COUNT(*) as cnt FROM page p WHERE ${where}`, countParams
    );
    console.log(`Pages to process: ${totalRemaining.toLocaleString()}`);
    console.log(`Direction: ${isDesc ? 'DESC (newest first)' : 'ASC (oldest first)'}`);

    const totalToProcess = limit ? Math.min(limit, totalRemaining) : totalRemaining;
    console.log(`Will process: ${totalToProcess.toLocaleString()}\n`);

    if (totalToProcess === 0) {
        console.log('Nothing to do!');
        return;
    }

    let processed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let lastId = isDesc ? Number.MAX_SAFE_INTEGER : 0;
    const startTime = Date.now();
    const allErrors = [];

    while (processed < totalToProcess) {
        const batchLimit = Math.min(BATCH_SIZE, totalToProcess - processed);
        const { where: batchWhere, params: batchParams } = buildWhereClause(force, chapterId);
        const idOp = isDesc ? '<' : '>';
        const orderDir = isDesc ? 'DESC' : 'ASC';
        const sql = `SELECT p.id, p.slug, p.image, p.chapter_id, SUBSTRING_INDEX(c.source_url, '/', 3) as source_origin FROM page p JOIN chapter c ON p.chapter_id = c.id WHERE ${batchWhere} AND p.id ${idOp} ? ORDER BY p.id ${orderDir} LIMIT ?`;
        batchParams.push(lastId, batchLimit);

        const [pages] = await db.query(sql, batchParams);
        if (pages.length === 0) break;
        lastId = pages[pages.length - 1].id;

        const result = await runPool(pages, concurrency, processPage);
        totalSuccess += result.success;
        totalFailed += result.failed;
        processed += pages.length;
        allErrors.push(...result.errors);

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalSuccess / elapsed;
        const eta = rate > 0 ? ((totalToProcess - processed) / rate / 60).toFixed(1) : '?';

        console.log(
            `[${processed.toLocaleString()}/${totalToProcess.toLocaleString()}] ` +
            `OK: ${result.success} | FAIL: ${result.failed} | ` +
            `Speed: ${rate.toFixed(1)} img/s | ETA: ${eta}min`
        );
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('\n===== DONE =====');
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Success: ${totalSuccess.toLocaleString()}`);
    console.log(`Failed:  ${totalFailed.toLocaleString()}`);
    console.log(`Time:    ${elapsed} min`);

    if (allErrors.length > 0) {
        console.log(`\nFailed pages (${allErrors.length}):`);
        for (const e of allErrors.slice(0, 50)) {
            console.log(`  id=${e.id} ${e.error} — ${e.image}`);
        }
        if (allErrors.length > 50) console.log(`  ... and ${allErrors.length - 50} more`);
    }
}

async function main() {
    const opts = parseArgs();

    console.log('=== Migrate Pages to S3 ===');
    console.log(`Time: ${new Date().toISOString()}`);
    const mode = opts.verify ? 'VERIFY (check S3, upload missing)' :
                 opts.force ? 'FORCE (re-upload all)' : 'incremental (unmigrated only)';
    console.log(`Mode: ${mode}`);
    console.log(`Direction: ${opts.direction.toUpperCase()}`);
    console.log(`Concurrency: ${opts.concurrency}`);
    if (opts.limit) console.log(`Limit: ${opts.limit}`);
    if (opts.chapterId) console.log(`Chapter ID: ${opts.chapterId}`);
    console.log('');

    if (opts.verify) {
        await runVerifyMode(opts);
    } else {
        await runMigrateMode(opts);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
