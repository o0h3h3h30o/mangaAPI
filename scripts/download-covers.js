#!/usr/bin/env node

/**
 * Download manga cover images by crawling source pages (jestful.net).
 *
 * Usage: node scripts/download-covers.js
 *
 * Flow:
 *   1. Read `from_manga18fx` field (comma-separated source URLs) from each manga
 *   2. Fetch the first URL for each manga
 *   3. Parse HTML to find cover image: div.info-cover img[src]
 *   4. Download that image and save as {slug}.jpg
 *
 * Env vars (from ../.env):
 *   COVER_SAVE_DIR - local directory to save covers
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../config/database');

const COVER_SAVE_DIR = process.env.COVER_SAVE_DIR || path.join(__dirname, '../../public/cover');
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchPage(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function extractCoverUrl(html) {
    // Match: <div class="info-cover"> ... <img ... src="...">
    const match = html.match(/info-cover[\s\S]*?<img[^>]*src=["']([^"']+)["']/i);
    return match ? match[1] : null;
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);

        const req = proto.get(url, {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            res.pipe(file);
            file.on('finish', () => {
                file.close();
                const stats = fs.statSync(destPath);
                if (stats.size < 1000) {
                    fs.unlinkSync(destPath);
                    reject(new Error('File too small'));
                } else {
                    resolve();
                }
            });
        });

        req.on('error', (err) => {
            file.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            reject(err);
        });
        req.on('timeout', () => {
            req.destroy();
            file.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            reject(new Error('Timeout'));
        });
    });
}

async function processManga(manga, idx, total) {
    // Truncate slug if filename would exceed OS limit (255 bytes)
    const maxSlugLen = 245; // 245 + ".jpg" = 249, safe under 255
    const slug = manga.slug.length > maxSlugLen ? manga.slug.substring(0, maxSlugLen) : manga.slug;
    const destPath = path.join(COVER_SAVE_DIR, `${slug}.jpg`);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
        return 'skipped';
    }

    // Get first source URL from from_manga18fx
    const sourceUrl = manga.from_manga18fx.split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!sourceUrl) {
        console.error(`[${idx}/${total}] NO_URL: ${manga.slug}`);
        return 'failed';
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Step 1: Fetch the source page
            const html = await fetchPage(sourceUrl);

            // Step 2: Extract cover image URL
            const coverUrl = extractCoverUrl(html);
            if (!coverUrl) {
                console.error(`[${idx}/${total}] NO_COVER: ${manga.slug} — could not find img in info-cover`);
                return 'failed';
            }

            // Step 3: Download the cover image
            await downloadFile(coverUrl, destPath);
            console.log(`[${idx}/${total}] OK: ${manga.slug}.jpg`);
            return 'success';
        } catch (err) {
            if (attempt === MAX_RETRIES) {
                console.error(`[${idx}/${total}] FAIL: ${manga.slug} — ${err.message}`);
                return 'failed';
            }
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}

async function processChunk(items, startIndex, total) {
    const results = { success: 0, failed: 0, skipped: 0 };

    await Promise.all(items.map(async (manga, i) => {
        const idx = startIndex + i + 1;
        const result = await processManga(manga, idx, total);
        results[result]++;
    }));

    return results;
}

async function main() {
    console.log(`Cover save dir: ${COVER_SAVE_DIR}`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log('---');

    fs.mkdirSync(COVER_SAVE_DIR, { recursive: true });

    // Get all manga with source URLs
    const [rows] = await db.query(
        "SELECT slug, from_manga18fx FROM manga WHERE from_manga18fx IS NOT NULL AND from_manga18fx != '' ORDER BY id ASC"
    );
    const total = rows.length;
    console.log(`Found ${total} manga with source URLs.\n`);

    const stats = { success: 0, failed: 0, skipped: 0 };

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const result = await processChunk(chunk, i, total);
        stats.success += result.success;
        stats.failed += result.failed;
        stats.skipped += result.skipped;
    }

    console.log('\n===== DONE =====');
    console.log(`Total:    ${total}`);
    console.log(`Success:  ${stats.success}`);
    console.log(`Failed:   ${stats.failed}`);
    console.log(`Skipped:  ${stats.skipped} (already existed)`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
