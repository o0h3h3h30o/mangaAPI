/**
 * Cover Image Processor
 * Download cover image → resize with sharp → save 2 versions:
 *   - {id}.jpg      (600px width, quality 85) — detail page, OG image
 *   - {id}-thumb.jpg (300px width, quality 80) — grid card, carousel, sidebar
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { withProxy } = require('./proxy');

const COVER_SAVE_DIR = process.env.COVER_SAVE_DIR || path.join(__dirname, '../../public/cover');

const SIZES = {
    full:  { width: 600, quality: 85 },
    thumb: { width: 300, quality: 80 },
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Download image URL → Buffer
 */
async function downloadToBuffer(url, referer) {
    const headers = { 'User-Agent': USER_AGENT };
    if (referer) headers['Referer'] = referer;
    const res = await fetch(url, withProxy({ headers }));
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Resize image buffer → save 2 versions (full + thumb)
 */
async function processAndSaveCover(imageBuffer, id) {
    fs.mkdirSync(COVER_SAVE_DIR, { recursive: true });

    const fullPath  = path.join(COVER_SAVE_DIR, `${id}.jpg`);
    const thumbPath = path.join(COVER_SAVE_DIR, `${id}-thumb.jpg`);

    await Promise.all([
        sharp(imageBuffer)
            .flatten({ background: '#ffffff' })
            .resize(SIZES.full.width)
            .jpeg({ quality: SIZES.full.quality })
            .toFile(fullPath),
        sharp(imageBuffer)
            .flatten({ background: '#ffffff' })
            .resize(SIZES.thumb.width)
            .jpeg({ quality: SIZES.thumb.quality })
            .toFile(thumbPath),
    ]);

    return { fullPath, thumbPath };
}

/**
 * Download cover from URL → resize → save
 * Returns true if success, false if failed
 */
async function downloadAndProcessCover(coverUrl, id, referer) {
    const buffer = await downloadToBuffer(coverUrl, referer);
    const { fullPath, thumbPath } = await processAndSaveCover(buffer, id);

    const fullSize  = fs.statSync(fullPath).size;
    const thumbSize = fs.statSync(thumbPath).size;
    console.log(`  [+] Cover: ${id}.jpg (${Math.round(fullSize/1024)}KB) + thumb (${Math.round(thumbSize/1024)}KB)`);

    return true;
}

/**
 * Check if both cover versions already exist
 */
function coverExists(id) {
    const fullPath  = path.join(COVER_SAVE_DIR, `${id}.jpg`);
    const thumbPath = path.join(COVER_SAVE_DIR, `${id}-thumb.jpg`);
    return fs.existsSync(fullPath) && fs.existsSync(thumbPath);
}

module.exports = {
    COVER_SAVE_DIR,
    SIZES,
    downloadToBuffer,
    processAndSaveCover,
    downloadAndProcessCover,
    coverExists,
};
