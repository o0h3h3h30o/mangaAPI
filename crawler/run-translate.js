#!/usr/bin/env node
/**
 * Translate Korean manga names to English and save to otherNames
 *
 * Usage:
 *   node crawler/run-translate.js                # translate all untranslated
 *   node crawler/run-translate.js --limit 50     # translate 50 manga
 *   node crawler/run-translate.js --id 123       # translate specific manga
 *   node crawler/run-translate.js --dry-run      # preview only, no DB update
 */

const translate = require('google-translate-api-x');
const db = require('./config/database');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) flags.limit = parseInt(args[i + 1], 10);
    if (args[i] === '--id' && args[i + 1]) flags.id = parseInt(args[i + 1], 10);
    if (args[i] === '--dry-run') flags.dryRun = true;
}

const BATCH_DELAY = 1500; // ms between requests to avoid rate limiting

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Translate text from Korean to English
 */
async function translateKoEn(text) {
    const res = await translate(text, { from: 'ko', to: 'en' });
    return res.text;
}

/**
 * Get manga that need translation
 * - otherNames is empty or NULL
 * - name contains Korean characters
 */
async function getMangaToTranslate(limit, specificId) {
    if (specificId) {
        const [rows] = await db.query('SELECT id, name, otherNames FROM manga WHERE id = ?', [specificId]);
        return rows;
    }

    const [rows] = await db.query(
        `SELECT id, name, otherNames FROM manga
         WHERE (otherNames IS NULL OR otherNames = '')
           AND name REGEXP '[가-힣]'
         ORDER BY id ASC
         LIMIT ?`,
        [limit || 9999]
    );
    return rows;
}

async function run() {
    const mangaList = await getMangaToTranslate(flags.limit, flags.id);
    console.log(`[*] Found ${mangaList.length} manga to translate\n`);

    if (mangaList.length === 0) {
        console.log('[=] Nothing to translate');
        process.exit(0);
    }

    let translated = 0;
    let failed = 0;

    for (const manga of mangaList) {
        try {
            const englishName = await translateKoEn(manga.name);
            console.log(`  [${manga.id}] ${manga.name} → ${englishName}`);

            if (!flags.dryRun) {
                await db.query(
                    'UPDATE manga SET otherNames = ? WHERE id = ?',
                    [englishName, manga.id]
                );
            }

            translated++;
            await sleep(BATCH_DELAY);
        } catch (err) {
            console.error(`  [!] Failed id=${manga.id}: ${err.message}`);
            failed++;
            // Rate limited → wait longer
            if (err.message.includes('429') || err.message.includes('Too Many')) {
                console.log('  [~] Rate limited, waiting 10s...');
                await sleep(10000);
            }
        }
    }

    console.log(`\n[*] Done: ${translated} translated, ${failed} failed`);
    process.exit(0);
}

run().catch(err => {
    console.error('[!] Fatal:', err);
    process.exit(1);
});
