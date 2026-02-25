#!/usr/bin/env node
/**
 * Sync manga update_at from newest chapter's created_at
 *
 * Usage:
 *   node crawler/run-sync-time.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./config/database');

async function run() {
    const [result] = await db.query(`
        UPDATE manga m
        SET m.update_at = (
            SELECT UNIX_TIMESTAMP(MAX(c.created_at))
            FROM chapter c
            WHERE c.manga_id = m.id
        )
        WHERE EXISTS (SELECT 1 FROM chapter c2 WHERE c2.manga_id = m.id)
    `);

    console.log(`[*] Done: ${result.affectedRows} manga updated`);
    process.exit(0);
}

run().catch(err => {
    console.error('[!] Fatal:', err);
    process.exit(1);
});
