#!/usr/bin/env node
/**
 * Download page images from external sources to LOCAL DISK (plain files)
 *
 * Flow: Source CDN --[proxy]--> RAM buffer ---> {IMAGE_DIR}/chapter/{id}/{file}
 *       Then UPDATE page SET image_local = '{filename}'
 *
 * Files are written as real images (e.g. /data/images/chapter/1000/1.jpg) so an
 * nginx `root {IMAGE_DIR}` can serve them directly — no MinIO/S3 needed.
 * The on-disk layout (chapter/{id}/{file}) matches the URL the API builds:
 *   `${S3_PUBLIC_URL}/chapter/{id}/{image_local}`  → S3_PUBLIC_URL = https://cdn.domain
 *
 * Run this ON the storage server (the one with the big disk + nginx). Point its
 * .env DB_HOST at the app DB.
 *
 * Usage:
 *   node scripts/download-pages-to-disk.js                  # unmigrated pages only
 *   node scripts/download-pages-to-disk.js --force          # re-download ALL
 *   node scripts/download-pages-to-disk.js --verify         # only download files missing on disk
 *   node scripts/download-pages-to-disk.js --limit 10000
 *   node scripts/download-pages-to-disk.js --chapter-id 123
 *   node scripts/download-pages-to-disk.js --concurrency 200
 *   node scripts/download-pages-to-disk.js --direction desc # newest first
 *   node scripts/download-pages-to-disk.js --dir /data/images
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const db = require('../config/database');
const { withProxy } = require('../crawler/proxy');

const BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 100;
const VERIFY_CONCURRENCY = 500;
const MAX_RETRIES = 2;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Root dir where images are stored. nginx serves this as the CDN root.
const IMAGE_DIR = (() => {
    const args = process.argv.slice(2);
    const i = args.indexOf('--dir');
    if (i !== -1 && args[i + 1]) return args[i + 1];
    return process.env.IMAGE_DIR || '/data/images';
})();

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
    const headers = { 'User-Agent': USER_AGENT, 'Referer': referer || '' };

    // Try with proxy first
    const res = await fetch(url, withProxy({ headers, signal: AbortSignal.timeout(30000) }));
    if (res.ok) return Buffer.from(await res.arrayBuffer());

    // Proxy might be blocked → retry direct (no proxy)
    if (res.status === 403 || res.status === 404) {
        const directRes = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
        if (directRes.ok) return Buffer.from(await directRes.arrayBuffer());
        throw new Error(`HTTP ${directRes.status} (direct)`);
    }
    throw new Error(`HTTP ${res.status}`);
}

function getExtension(url) {
    const ext = url.split('.').pop().split('?')[0].toLowerCase();
    if (['png', 'webp', 'gif', 'jpg', 'jpeg'].includes(ext)) return '.' + ext;
    return '.jpg';
}

function getPaths(page) {
    const filename = page.slug + getExtension(page.image);
    const dir = path.join(IMAGE_DIR, 'chapter', String(page.chapter_id));
    return { filename, dir, fullPath: path.join(dir, filename) };
}

async function processPage(page) {
    const { filename, dir, fullPath } = getPaths(page);
    const referer = page.source_origin || '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const buffer = await downloadImage(page.image, referer);
            await fsp.mkdir(dir, { recursive: true });
            // Write atomically: temp file then rename, so a crash can't leave a partial image
            const tmp = `${fullPath}.tmp`;
            await fsp.writeFile(tmp, buffer);
            await fsp.rename(tmp, fullPath);
            await db.query('UPDATE page SET image_local = ? WHERE id = ?', [filename, page.id]);
            return true;
        } catch (err) {
            // 404 = image gone from CDN → mark _404 so we skip it next time
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
    let success = 0, failed = 0, skipped = 0;
    const errors = [];
    let running = 0, idx = 0;

    return new Promise((resolve) => {
        function next() {
            while (running < concurrency && idx < items.length) {
                const item = items[idx++];
                running++;
                handler(item)
                    .then((result) => {
                        if (result === 'skipped' || result === '_404') skipped++;
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
    if (!force) conditions.push("(p.image_local IS NULL OR p.image_local = '')");
    if (chapterId) { conditions.push('p.chapter_id = ?'); params.push(chapterId); }
    return { where: conditions.join(' AND '), params };
}

// ==================== VERIFY MODE (re-download files missing on disk) ====================
async function runVerifyMode({ limit, chapterId, concurrency }) {
    const verifyConcurrency = Math.max(concurrency, VERIFY_CONCURRENCY);
    const conditions = ['external = 1', "image_local IS NOT NULL", "image_local != ''", "image_local != '_404'"];
    const params = [];
    if (chapterId) { conditions.push('chapter_id = ?'); params.push(chapterId); }

    const [[{ cnt: totalToScan }]] = await db.query(
        `SELECT COUNT(*) as cnt FROM page WHERE ${conditions.join(' AND ')}`, params
    );
    console.log(`Pages to verify on disk: ${totalToScan.toLocaleString()}\n`);

    let scanned = 0, missing = 0, redownloaded = 0, failedDl = 0, lastId = 0;
    const startTime = Date.now();

    while (scanned < totalToScan) {
        const sql = `SELECT p.id, p.slug, p.image, p.image_local, p.chapter_id, SUBSTRING_INDEX(c.source_url, '/', 3) as source_origin
                     FROM page p JOIN chapter c ON p.chapter_id = c.id
                     WHERE p.external = 1 AND p.image_local IS NOT NULL AND p.image_local != '' AND p.image_local != '_404'
                       ${chapterId ? 'AND p.chapter_id = ?' : ''} AND p.id > ?
                     ORDER BY p.id ASC LIMIT ?`;
        const sqlParams = chapterId ? [chapterId, lastId, BATCH_SIZE] : [lastId, BATCH_SIZE];
        const [pages] = await db.query(sql, sqlParams);
        if (pages.length === 0) break;
        lastId = pages[pages.length - 1].id;
        scanned += pages.length;

        // Keep only pages whose file is actually missing on disk
        const missingPages = [];
        for (const p of pages) {
            const fullPath = path.join(IMAGE_DIR, 'chapter', String(p.chapter_id), p.image_local);
            if (!fs.existsSync(fullPath)) missingPages.push(p);
        }
        missing += missingPages.length;

        if (missingPages.length > 0) {
            const result = await runPool(missingPages, verifyConcurrency, processPage);
            redownloaded += result.success;
            failedDl += result.failed;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = scanned / elapsed;
        const eta = rate > 0 ? ((totalToScan - scanned) / rate / 60).toFixed(1) : '?';
        console.log(`[${scanned.toLocaleString()}/${totalToScan.toLocaleString()}] Missing: ${missingPages.length} | Re-dl: ${redownloaded} | ${rate.toFixed(0)} check/s | ETA: ${eta}min`);
    }

    console.log('\n===== VERIFY DONE =====');
    console.log(`Scanned: ${scanned.toLocaleString()} | Missing: ${missing.toLocaleString()} | Re-downloaded: ${redownloaded.toLocaleString()} | Failed: ${failedDl.toLocaleString()}`);
}

// ==================== NORMAL/FORCE MODE ====================
async function runDownloadMode({ force, limit, chapterId, concurrency, direction }) {
    const isDesc = direction === 'desc';
    const { where, params: countParams } = buildWhereClause(force, chapterId);
    const [[{ cnt: totalRemaining }]] = await db.query(`SELECT COUNT(*) as cnt FROM page p WHERE ${where}`, countParams);
    console.log(`Pages to process: ${totalRemaining.toLocaleString()}`);
    console.log(`Direction: ${isDesc ? 'DESC (newest first)' : 'ASC (oldest first)'}`);

    const totalToProcess = limit ? Math.min(limit, totalRemaining) : totalRemaining;
    console.log(`Will process: ${totalToProcess.toLocaleString()}\n`);
    if (totalToProcess === 0) { console.log('Nothing to do!'); return; }

    let processed = 0, totalSuccess = 0, totalFailed = 0;
    let lastId = isDesc ? Number.MAX_SAFE_INTEGER : 0;
    const startTime = Date.now();
    const allErrors = [];

    while (processed < totalToProcess) {
        const batchLimit = Math.min(BATCH_SIZE, totalToProcess - processed);
        const { where: batchWhere, params: batchParams } = buildWhereClause(force, chapterId);
        const idOp = isDesc ? '<' : '>';
        const orderDir = isDesc ? 'DESC' : 'ASC';
        const sql = `SELECT p.id, p.slug, p.image, p.chapter_id, SUBSTRING_INDEX(c.source_url, '/', 3) as source_origin
                     FROM page p JOIN chapter c ON p.chapter_id = c.id
                     WHERE ${batchWhere} AND p.id ${idOp} ? ORDER BY p.id ${orderDir} LIMIT ?`;
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
        console.log(`[${processed.toLocaleString()}/${totalToProcess.toLocaleString()}] OK: ${result.success} | FAIL: ${result.failed} | ${rate.toFixed(1)} img/s | ETA: ${eta}min`);
    }

    console.log('\n===== DONE =====');
    console.log(`Total processed: ${processed.toLocaleString()} | Success: ${totalSuccess.toLocaleString()} | Failed: ${totalFailed.toLocaleString()}`);
    if (allErrors.length > 0) {
        console.log(`\nFailed pages (${allErrors.length}):`);
        for (const e of allErrors.slice(0, 50)) console.log(`  id=${e.id} ${e.error} — ${e.image}`);
        if (allErrors.length > 50) console.log(`  ... and ${allErrors.length - 50} more`);
    }
}

async function main() {
    const opts = parseArgs();
    console.log('=== Download Pages to Disk ===');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Image dir: ${IMAGE_DIR}`);
    console.log(`Mode: ${opts.verify ? 'VERIFY (re-download files missing on disk)' : opts.force ? 'FORCE (re-download all)' : 'incremental (unmigrated only)'}`);
    console.log(`Direction: ${opts.direction.toUpperCase()} | Concurrency: ${opts.concurrency}`);
    if (opts.limit) console.log(`Limit: ${opts.limit}`);
    if (opts.chapterId) console.log(`Chapter ID: ${opts.chapterId}`);
    console.log('');

    await fs.promises.mkdir(IMAGE_DIR, { recursive: true });

    if (opts.verify) await runVerifyMode(opts);
    else await runDownloadMode(opts);

    process.exit(0);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
