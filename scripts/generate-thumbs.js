#!/usr/bin/env node

/**
 * Generate thumbnail versions for existing cover images.
 * Reads all {slug}.jpg files in COVER_SAVE_DIR that don't have a {slug}-thumb.jpg
 * and creates the 300px thumbnail.
 *
 * Usage: node scripts/generate-thumbs.js [--force]
 *
 * Flags:
 *   --force  Re-generate thumbs even if they already exist
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const COVER_SAVE_DIR = process.env.COVER_SAVE_DIR || path.join(__dirname, '../../public/cover');
const THUMB_WIDTH = 300;
const THUMB_QUALITY = 80;
const FORCE = process.argv.includes('--force');

async function main() {
    console.log(`Cover dir: ${COVER_SAVE_DIR}`);
    console.log(`Force: ${FORCE}`);
    console.log('---');

    const files = fs.readdirSync(COVER_SAVE_DIR).filter(f =>
        f.endsWith('.jpg') && !f.endsWith('-thumb.jpg')
    );

    console.log(`Found ${files.length} cover images.\n`);

    let created = 0, skipped = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const slug = file.replace('.jpg', '');
        const srcPath = path.join(COVER_SAVE_DIR, file);
        const thumbPath = path.join(COVER_SAVE_DIR, `${slug}-thumb.jpg`);

        if (!FORCE && fs.existsSync(thumbPath)) {
            skipped++;
            continue;
        }

        try {
            await sharp(srcPath)
                .resize(THUMB_WIDTH)
                .jpeg({ quality: THUMB_QUALITY })
                .toFile(thumbPath);

            const thumbSize = fs.statSync(thumbPath).size;
            console.log(`[${i + 1}/${files.length}] OK: ${slug}-thumb.jpg (${Math.round(thumbSize / 1024)}KB)`);
            created++;
        } catch (err) {
            console.error(`[${i + 1}/${files.length}] FAIL: ${slug} — ${err.message}`);
            failed++;
        }
    }

    console.log('\n===== DONE =====');
    console.log(`Created: ${created}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed:  ${failed}`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
